//! Protocol 5 message framing. Transfer buffers have a fixed size; large JSON
//! messages spill to an anonymous temporary file instead of a giant byte Vec.
//! Small, pre-authentication messages additionally enforce a cumulative limit.
use anyhow::{Context, Result, ensure};
use serde::{Serialize, de::DeserializeOwned};
use std::{
    fs::File,
    io::{self, BufReader, BufWriter, Cursor, Read, Seek, SeekFrom, Write},
    time::Duration,
};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub(super) const CHUNK_BYTES: usize = 256 * 1024;
const MEMORY_BYTES: usize = CHUNK_BYTES;
const FRAME_IDLE: Duration = Duration::from_secs(90);

/// The byte representation is bounded in memory independently of entry count.
/// `tempfile()` uses a private, automatically deleted file on supported targets.
enum Spool {
    Memory(Cursor<Vec<u8>>),
    Disk(File),
}
impl Spool {
    fn new() -> Self {
        Self::Memory(Cursor::new(Vec::new()))
    }
    fn rewind(&mut self) -> io::Result<()> {
        match self {
            Self::Memory(bytes) => {
                bytes.set_position(0);
                Ok(())
            }
            Self::Disk(file) => file.seek(SeekFrom::Start(0)).map(|_| ()),
        }
    }
}
impl Write for Spool {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if let Self::Memory(memory) = self
            && memory.get_ref().len().saturating_add(bytes.len()) > MEMORY_BYTES
        {
            let mut file = tempfile::tempfile()?;
            file.write_all(memory.get_ref())?;
            *self = Self::Disk(file);
        }
        match self {
            Self::Memory(memory) => Write::write(memory, bytes),
            Self::Disk(file) => file.write(bytes),
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        match self {
            Self::Memory(memory) => Write::flush(memory),
            Self::Disk(file) => file.flush(),
        }
    }
}
impl Read for Spool {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        match self {
            Self::Memory(memory) => Read::read(memory, bytes),
            Self::Disk(file) => file.read(bytes),
        }
    }
}

pub(super) async fn send(
    stream: &mut (impl AsyncWrite + Unpin),
    version: u8,
    value: &impl Serialize,
) -> Result<()> {
    // Serialization finishes before a message header is sent. A local spool or
    // encoding failure can therefore never masquerade as a complete message.
    let mut spool = Spool::new();
    {
        let mut buffered = BufWriter::with_capacity(32 * 1024, &mut spool);
        serde_json::to_writer(&mut buffered, value).context("无法准备分批传输的消息")?;
        buffered.flush()?;
    }
    spool.rewind()?;
    tokio::time::timeout(FRAME_IDLE, stream.write_all(&[b'S', b'F', b'U', version]))
        .await
        .context("消息发送等待超时")??;
    let mut buffer = vec![0; CHUNK_BYTES];
    let mut sequence = 0u64;
    loop {
        let length = spool.read(&mut buffer)?;
        tokio::time::timeout(FRAME_IDLE, async {
            stream.write_u64(sequence).await?;
            stream.write_u32(length as u32).await?;
            if length == 0 {
                stream.flush().await?;
            } else {
                stream.write_all(&buffer[..length]).await?;
            }
            Ok::<_, io::Error>(())
        })
        .await
        .context("消息分块发送停滞")??;
        if length == 0 {
            return Ok(());
        }
        sequence = sequence.checked_add(1).context("消息分块序号溢出")?;
    }
}

pub(super) async fn receive<T: DeserializeOwned>(
    stream: &mut (impl AsyncRead + Unpin),
    version: u8,
    limit: Option<usize>,
) -> Result<T> {
    receive_with_idle(stream, version, limit, FRAME_IDLE, None).await
}

/// A paired peer may spend a long time on its own disk between requests (local
/// begin, seal or apply). Keep that session alive for the business-operation
/// deadline. Once bytes arrive, every frame still has the shorter stall limit.
pub(super) async fn receive_request<T: DeserializeOwned>(
    stream: &mut (impl AsyncRead + Unpin),
    version: u8,
    first_byte_wait: Duration,
) -> Result<T> {
    receive_with_idle(stream, version, None, FRAME_IDLE, Some(first_byte_wait)).await
}

async fn receive_with_idle<T: DeserializeOwned>(
    stream: &mut (impl AsyncRead + Unpin),
    version: u8,
    limit: Option<usize>,
    idle: Duration,
    first_byte_wait: Option<Duration>,
) -> Result<T> {
    // Before the first response byte, the caller's business-operation deadline
    // applies (for example, a long scan). After it starts, every frame must make
    // progress within the idle deadline, regardless of total message size.
    let mut header = [0u8; 4];
    if let Some(wait) = first_byte_wait {
        tokio::time::timeout(wait, stream.read_exact(&mut header[..1]))
            .await
            .context("等待设备请求超时")??;
    } else {
        stream.read_exact(&mut header[..1]).await?;
    }
    tokio::time::timeout(idle, stream.read_exact(&mut header[1..]))
        .await
        .context("消息头接收停滞")??;
    ensure!(
        header == [b'S', b'F', b'U', version],
        "两端 SyncFu 协议版本不一致，请更新两端应用"
    );
    let mut spool = Spool::new();
    let mut buffer = vec![0; limit.unwrap_or(CHUNK_BYTES).min(CHUNK_BYTES)];
    let mut expected_sequence = 0u64;
    let mut total = 0u64;
    loop {
        let length = tokio::time::timeout(idle, async {
            let sequence = stream.read_u64().await?;
            let length = stream.read_u32().await? as usize;
            ensure!(sequence == expected_sequence, "消息分块顺序无效");
            ensure!(length <= CHUNK_BYTES, "消息分块超过允许大小");
            if length == 0 {
                ensure!(total > 0, "空消息无效");
                return Ok(length);
            }
            total = total.checked_add(length as u64).context("消息大小溢出")?;
            // Check cumulative size before reading payload bytes or writing to disk.
            ensure!(
                limit.is_none_or(|limit| total <= limit as u64),
                "消息超过允许大小"
            );
            stream.read_exact(&mut buffer[..length]).await?;
            Ok::<_, anyhow::Error>(length)
        })
        .await
        .context("消息分块接收停滞")??;
        if length == 0 {
            break;
        }
        spool
            .write_all(&buffer[..length])
            .context("无法暂存分批接收的消息")?;
        expected_sequence = expected_sequence
            .checked_add(1)
            .context("消息分块序号溢出")?;
    }
    spool.rewind()?;
    // from_reader validates the entire document including trailing content.
    serde_json::from_reader(BufReader::with_capacity(64 * 1024, spool))
        .context("消息内容无效或不完整")
}

#[cfg(test)]
mod tests {
    use super::*;
    const VERSION: u8 = 5;

    async fn roundtrip(value: &str) -> Result<String> {
        let (mut writer, mut reader) = tokio::io::duplex(8192);
        let (sent, received) = tokio::join!(
            send(&mut writer, VERSION, &value),
            receive::<String>(&mut reader, VERSION, None),
        );
        sent?;
        received
    }

    #[tokio::test]
    async fn frames_preserve_boundaries_unicode_and_multiple_messages() -> Result<()> {
        for length in [
            0,
            CHUNK_BYTES - 3,
            CHUNK_BYTES - 2,
            CHUNK_BYTES - 1,
            CHUNK_BYTES,
            CHUNK_BYTES + 1,
            CHUNK_BYTES * 2 + 19,
        ] {
            let value = "x".repeat(length) + "中文/é/🦊";
            assert_eq!(roundtrip(&value).await?, value);
        }
        let (mut writer, mut reader) = tokio::io::duplex(512);
        let sending = async {
            send(&mut writer, VERSION, &17u64).await?;
            send(&mut writer, VERSION, &"next").await
        };
        let receiving = async {
            assert_eq!(receive::<u64>(&mut reader, VERSION, None).await?, 17);
            assert_eq!(receive::<String>(&mut reader, VERSION, None).await?, "next");
            Ok::<_, anyhow::Error>(())
        };
        let (a, b) = tokio::join!(sending, receiving);
        a?;
        b?;
        Ok(())
    }

    #[tokio::test]
    async fn messages_larger_than_the_former_32mib_limit_roundtrip() -> Result<()> {
        let value = "a".repeat(32 * 1024 * 1024 + CHUNK_BYTES + 17);
        assert_eq!(roundtrip(&value).await?, value);
        Ok(())
    }

    #[test]
    fn spool_memory_is_bounded_and_disk_keeps_exact_bytes() -> Result<()> {
        let mut spool = Spool::new();
        spool.write_all(&vec![1; MEMORY_BYTES])?;
        assert!(matches!(spool, Spool::Memory(_)));
        spool.write_all(&[2, 3])?;
        assert!(matches!(spool, Spool::Disk(_)));
        spool.rewind()?;
        let mut actual = Vec::new();
        spool.read_to_end(&mut actual)?;
        assert_eq!(actual.len(), MEMORY_BYTES + 2);
        assert_eq!(&actual[MEMORY_BYTES..], &[2, 3]);
        Ok(())
    }

    fn header() -> Vec<u8> {
        vec![b'S', b'F', b'U', VERSION]
    }
    fn frame(bytes: &mut Vec<u8>, sequence: u64, payload: &[u8]) {
        bytes.extend(sequence.to_be_bytes());
        bytes.extend((payload.len() as u32).to_be_bytes());
        bytes.extend(payload);
    }
    async fn error(bytes: Vec<u8>, limit: Option<usize>) -> String {
        format!(
            "{:#}",
            receive::<serde_json::Value>(&mut bytes.as_slice(), VERSION, limit)
                .await
                .expect_err("malformed message accepted")
        )
    }

    #[tokio::test]
    async fn malformed_frames_cannot_become_partial_messages() -> Result<()> {
        let mut empty = header();
        frame(&mut empty, 0, b"");
        assert!(error(empty, None).await.contains("空消息"));
        let mut missing_end = header();
        frame(&mut missing_end, 0, b"{}");
        let truncated = receive::<serde_json::Value>(&mut missing_end.as_slice(), VERSION, None)
            .await
            .expect_err("message without a terminal frame accepted");
        assert!(truncated.chain().any(|cause| {
            cause
                .downcast_ref::<io::Error>()
                .is_some_and(|error| error.kind() == io::ErrorKind::UnexpectedEof)
        }));
        let mut wrong_sequence = header();
        frame(&mut wrong_sequence, 1, b"{}");
        frame(&mut wrong_sequence, 2, b"");
        assert!(error(wrong_sequence, None).await.contains("顺序"));
        let mut duplicate = header();
        frame(&mut duplicate, 0, b"{");
        frame(&mut duplicate, 0, b"}");
        assert!(error(duplicate, None).await.contains("顺序"));
        let mut incomplete = header();
        frame(&mut incomplete, 0, b"{");
        frame(&mut incomplete, 1, b"");
        assert!(error(incomplete, None).await.contains("内容无效"));
        let mut trailing = header();
        frame(&mut trailing, 0, b"{}{}");
        frame(&mut trailing, 1, b"");
        assert!(error(trailing, None).await.contains("内容无效"));
        let mut oversize = header();
        oversize.extend(0u64.to_be_bytes());
        oversize.extend((CHUNK_BYTES as u32 + 1).to_be_bytes());
        assert!(error(oversize, None).await.contains("分块超过"));
        let mut old = vec![0, 0, 0, 4];
        old.extend(b"[4,{}]");
        assert!(error(old, None).await.contains("协议版本不一致"));
        Ok(())
    }

    #[tokio::test]
    async fn incomplete_frame_times_out_without_accepting_a_partial_message() -> Result<()> {
        let (mut writer, mut reader) = tokio::io::duplex(512);
        writer.write_all(&header()).await?;
        writer.write_u64(0).await?;
        writer.write_u32(2).await?;
        writer.write_all(b"{").await?;
        let result = receive_with_idle::<serde_json::Value>(
            &mut reader,
            VERSION,
            None,
            Duration::from_millis(20),
            None,
        )
        .await;
        assert!(format!("{:#}", result.expect_err("stalled frame accepted")).contains("接收停滞"));
        Ok(())
    }

    #[tokio::test]
    async fn initial_request_deadline_does_not_limit_active_message_duration() -> Result<()> {
        let (mut writer, mut reader) = tokio::io::duplex(512);
        let sending = async {
            writer.write_all(&header()).await?;
            for (sequence, payload) in [b"{".as_slice(), b"}", b""].into_iter().enumerate() {
                tokio::time::sleep(Duration::from_millis(30)).await;
                let mut bytes = Vec::new();
                frame(&mut bytes, sequence as u64, payload);
                writer.write_all(&bytes).await?;
            }
            Ok::<_, anyhow::Error>(())
        };
        let receiving = receive_with_idle::<serde_json::Value>(
            &mut reader,
            VERSION,
            None,
            Duration::from_millis(200),
            Some(Duration::from_millis(20)),
        );
        let (sent, received) = tokio::join!(sending, receiving);
        sent?;
        assert_eq!(received?, serde_json::json!({}));
        let (_writer, mut reader) = tokio::io::duplex(512);
        let idle = receive_with_idle::<serde_json::Value>(
            &mut reader,
            VERSION,
            None,
            Duration::from_millis(200),
            Some(Duration::from_millis(20)),
        )
        .await
        .expect_err("idle request did not time out");
        assert!(format!("{idle:#}").contains("等待设备请求超时"));
        Ok(())
    }

    #[tokio::test]
    async fn local_disk_work_can_idle_longer_than_the_frame_stall_limit() -> Result<()> {
        let (mut writer, mut reader) = tokio::io::duplex(512);
        let sending = async {
            // No message has started while the peer finishes local disk work.
            tokio::time::sleep(Duration::from_millis(50)).await;
            let mut bytes = header();
            frame(&mut bytes, 0, b"{}");
            frame(&mut bytes, 1, b"");
            writer.write_all(&bytes).await
        };
        let receiving = receive_with_idle::<serde_json::Value>(
            &mut reader,
            VERSION,
            None,
            Duration::from_millis(20),
            Some(Duration::from_millis(250)),
        );
        let (sent, received) = tokio::join!(sending, receiving);
        sent?;
        assert_eq!(received?, serde_json::json!({}));
        Ok(())
    }

    #[tokio::test]
    async fn preauthentication_limit_is_cumulative_and_checked_before_payload() -> Result<()> {
        let mut over = header();
        frame(&mut over, 0, &vec![b' '; 16 * 1024]);
        over.extend(1u64.to_be_bytes());
        over.extend((16 * 1024 + 1u32).to_be_bytes());
        assert!(error(over, Some(32 * 1024)).await.contains("超过允许"));
        let value = "x".repeat(32 * 1024 - 2);
        let mut exact = header();
        frame(&mut exact, 0, &serde_json::to_vec(&value)?);
        frame(&mut exact, 1, b"");
        assert_eq!(
            receive::<String>(&mut exact.as_slice(), VERSION, Some(32 * 1024)).await?,
            value
        );
        Ok(())
    }
}
