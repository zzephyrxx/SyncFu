use crate::{
    conflicts::{
        self, ConflictPreview, ConflictResolution, Decision, DecisionRequest, PreviewRequest,
        ReviewNote,
    },
    engine::{self, Engine, Folder, Operation, PairState, Step, Work},
    files::{ScanPhase, ScanProgress},
    model::*,
    pairing::{self, ClientHandshake, Identity, Invite, SERVER_NAME},
    policy::*,
    risk::{ExecutionPreview, RiskAssessment},
};
use anyhow::{Context, Result, bail, ensure};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use rustls::pki_types::ServerName;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    net::{IpAddr, SocketAddr},
    path::Path,
    sync::{Arc, Mutex, MutexGuard, atomic::Ordering},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite},
    net::{TcpListener, TcpStream},
    sync::{Semaphore, oneshot},
    time::timeout,
};
use tokio_rustls::{TlsAcceptor, TlsConnector, client::TlsStream};

const SERVICE: &str = "_syncfu._tcp.local.";
mod progress;
use progress::ExecutionLog;
pub use progress::{ExecutionProgress, FileProgress, ProgressPage};
pub const PROTOCOL: u8 = 5;
const TIMEOUT: Duration = Duration::from_secs(90);
// A full content scan can legitimately take minutes on large or slow volumes.
// Other RPCs keep their short deadline; scan status travels on a separate session.
const SCAN_TIMEOUT: Duration = Duration::from_secs(30 * 60);
pub const DEFAULT_PORT: u16 = 47657;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Peer {
    id: String,
    name: String,
    address: String,
    cert: Vec<u8>,
    leaf: Vec<u8>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub port: u16,
    pub addresses: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerView {
    pub id: String,
    pub name: String,
    pub address: String,
    pub online: bool,
}

struct Nearby {
    name: String,
    addresses: Vec<SocketAddr>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderList {
    pub local: Vec<Folder>,
    pub remote: Vec<Folder>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub protocol: u8,
    pub device: Device,
    pub peers: Vec<PeerView>,
    pub nearby: Vec<PeerView>,
    pub pending: Vec<PeerView>,
    pub tasks: Vec<Task>,
    pub history: Vec<Batch>,
    pub dirty: Vec<String>,
    pub phase: Option<String>,
    #[serde(default)]
    pub scan: Option<ScanActivity>,
    #[serde(default)]
    pub execution: Option<ExecutionProgress>,
    pub network_error: Option<String>,
    pub policy_states: Vec<PolicyView>,
    pub paused_all: bool,
    pub automatic_supported: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanActivity {
    pub task: String,
    pub local: Option<ScanProgress>,
    pub remote: Option<ScanProgress>,
    pub incoming: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct GrantScanReport {
    grant: String,
    id: String,
    progress: ScanProgress,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Code {
    pub code: String,
    pub expires_at: u64,
}

#[derive(Serialize, Deserialize)]
struct Hello {
    cert: Vec<u8>,
    leaf: Vec<u8>,
    name: String,
    session: Option<String>,
}
#[derive(Serialize, Deserialize)]
struct PairStart {
    cert: Vec<u8>,
    leaf: Vec<u8>,
    name: String,
    port: u16,
    session: String,
    message: Vec<u8>,
}
struct Pending {
    peer: Peer,
    answer: oneshot::Sender<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
enum Rpc {
    Ping,
    Folders,
    Link(Task),
    Policy(String),
    OfferPolicy(Proposal),
    CommitPolicy {
        task: String,
        proposal: String,
        digest: String,
    },
    ConfirmPolicy {
        task: String,
        proposal: String,
        digest: String,
    },
    RejectPolicy {
        task: String,
        receipt: PolicyReceipt,
    },
    Preflight(Work),
    ApproveRisk(Work),
    Scan(String),
    ScanStatus(String),
    Progress {
        ticket: Ticket,
        after: usize,
    },
    PreviewFile(PreviewRequest),
    State(String),
    Observe {
        task: String,
        expected: PairState,
        common: Baseline,
    },
    Begin {
        work: Work,
        expected: PairState,
    },
    Read {
        ticket: Ticket,
        op: String,
        offset: u64,
    },
    Chunk {
        ticket: Ticket,
        op: String,
        offset: u64,
        data: String,
    },
    Seal(Ticket),
    Apply(Ticket),
    Cancel(Ticket),
    Outcome(Ticket),
    Finish {
        ticket: Ticket,
        applied: Vec<String>,
        status: String,
        message: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Ticket {
    id: String,
    digest: String,
}
impl From<&Work> for Ticket {
    fn from(w: &Work) -> Self {
        Self {
            id: w.batch.id.clone(),
            digest: w.digest.clone(),
        }
    }
}
#[derive(Debug, Serialize, Deserialize)]
struct Outcome {
    steps: Vec<(String, Step)>,
    batch: Option<Batch>,
    applied: Vec<String>,
}
type Reply = std::result::Result<serde_json::Value, String>;

struct Session(TlsStream<TcpStream>);
impl Session {
    async fn call<T: DeserializeOwned>(&mut self, request: Rpc) -> Result<T> {
        let deadline = if matches!(
            &request,
            Rpc::Scan(_)
                | Rpc::Preflight(_)
                | Rpc::ApproveRisk(_)
                | Rpc::Begin { .. }
                | Rpc::Seal(_)
                | Rpc::Apply(_)
                | Rpc::Outcome(_)
                | Rpc::Finish { .. }
                | Rpc::Observe { .. }
        ) {
            SCAN_TIMEOUT
        } else {
            TIMEOUT
        };
        timeout(deadline, async {
            send(&mut self.0, &request).await?;
            let reply: Reply = receive(&mut self.0).await?;
            Ok(serde_json::from_value(reply.map_err(anyhow::Error::msg)?)?)
        })
        .await
        .context("设备响应超时")?
    }
}

pub struct Node {
    pub engine: Engine,
    identity: Identity,
    device: Device,
    invite: Mutex<Option<Invite>>,
    pending: Mutex<Option<Pending>>,
    approved: Mutex<Option<(Peer, Instant)>>,
    nearby: Mutex<BTreeMap<String, Nearby>>,
    reachable: Mutex<BTreeMap<String, SocketAddr>>,
    seen: Mutex<BTreeMap<String, Instant>>,
    plans: Mutex<BTreeMap<String, (Plan, PairState)>>,
    phase: Mutex<Option<String>>,
    scan_gate: Mutex<()>,
    scan_report: Mutex<Option<GrantScanReport>>,
    scan_activity: Mutex<Option<ScanActivity>>,
    execution: Mutex<Option<ExecutionLog>>,
    incoming: Mutex<Option<(String, String)>>,
    network_error: Mutex<Option<String>>,
    dirty: Mutex<BTreeMap<String, u64>>,
    remote_dirty: Mutex<BTreeMap<String, BTreeSet<String>>>,
    review_pending: Mutex<BTreeSet<String>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    coordinator: tokio::sync::Mutex<()>,
    daemon: Mutex<Option<ServiceDaemon>>,
}

impl Node {
    pub async fn start(
        engine: Engine,
        identity: Identity,
        name: String,
        address: SocketAddr,
        discovery: bool,
    ) -> Result<Arc<Self>> {
        ensure!(
            address.ip().is_unspecified() || local_address(address.ip()),
            "监听地址须在局域网内"
        );
        engine.bind_device(&identity.id())?;
        let listener = TcpListener::bind(address)
            .await
            .context("无法启动局域网监听")?;
        let node = Arc::new(Self {
            engine,
            device: Device {
                id: identity.id(),
                name,
                port: listener.local_addr()?.port(),
                addresses: vec![],
            },
            identity,
            invite: Mutex::new(None),
            pending: Mutex::new(None),
            approved: Mutex::new(None),
            nearby: Mutex::new(BTreeMap::new()),
            reachable: Mutex::new(BTreeMap::new()),
            seen: Mutex::new(BTreeMap::new()),
            plans: Mutex::new(BTreeMap::new()),
            phase: Mutex::new(None),
            scan_gate: Mutex::new(()),
            scan_report: Mutex::new(None),
            scan_activity: Mutex::new(None),
            execution: Mutex::new(None),
            incoming: Mutex::new(None),
            network_error: Mutex::new(None),
            dirty: Mutex::new(BTreeMap::new()),
            remote_dirty: Mutex::new(BTreeMap::new()),
            review_pending: Mutex::new(BTreeSet::new()),
            watcher: Mutex::new(None),
            coordinator: tokio::sync::Mutex::new(()),
            daemon: Mutex::new(None),
        });
        let weak = Arc::downgrade(&node);
        let slots = Arc::new(Semaphore::new(12));
        tokio::spawn(async move {
            while let Ok((socket, address)) = listener.accept().await {
                let Some(node) = weak.upgrade() else {
                    break;
                };
                if !local_address(address.ip()) {
                    continue;
                }
                let Ok(slot) = slots.clone().try_acquire_owned() else {
                    continue;
                };
                tokio::spawn(async move {
                    let _slot = slot;
                    let _ = node.serve(socket, address).await;
                });
            }
        });
        if discovery && let Err(e) = node.start_discovery() {
            *lock(&node.network_error) = Some(e.to_string());
        }
        if let Err(e) = node.watch() {
            *lock(&node.network_error) = Some(format!("后台检测未启动：{e}"));
        }
        let weak = Arc::downgrade(&node);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(7)).await;
                let Some(node) = weak.upgrade() else {
                    break;
                };
                if let Ok(peers) = node.engine.store.list::<Peer>("peers") {
                    let mut probes = tokio::task::JoinSet::new();
                    for peer in peers {
                        let node = node.clone();
                        probes.spawn(async move {
                            if let Ok(mut session) = node.session(&peer).await
                                && let Ok(dirty) = session.call::<BTreeSet<String>>(Rpc::Ping).await
                            {
                                lock(&node.remote_dirty).insert(peer.id.clone(), dirty);
                                lock(&node.seen).insert(peer.id, Instant::now());
                            }
                        });
                    }
                    while probes.join_next().await.is_some() {}
                }
            }
        });
        let weak = Arc::downgrade(&node);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(3600)).await;
                let Some(node) = weak.upgrade() else {
                    break;
                };
                let _ = tokio::task::spawn_blocking(move || {
                    let _gate = lock(&node.engine.gate);
                    if matches!(node.engine.active(), Ok(None)) {
                        let _ = node.engine.clean_backups();
                    }
                })
                .await;
            }
        });
        Ok(node)
    }

    fn start_discovery(self: &Arc<Self>) -> Result<()> {
        let mdns = ServiceDaemon::new()?;
        let properties = [
            ("id", self.device.id.as_str()),
            ("name", self.device.name.as_str()),
        ];
        let hostname = format!("syncfu-{}.local.", &self.device.id[..12]);
        let service = ServiceInfo::new(
            SERVICE,
            &self.device.id[..16],
            &hostname,
            "",
            self.device.port,
            &properties[..],
        )?
        .enable_addr_auto();
        mdns.register(service)?;
        let receiver = mdns.browse(SERVICE)?;
        let weak = Arc::downgrade(self);
        tokio::spawn(async move {
            let mut names = BTreeMap::<String, String>::new();
            while let Ok(event) = receiver.recv_async().await {
                let Some(node) = weak.upgrade() else {
                    break;
                };
                match event {
                    ServiceEvent::ServiceResolved(info) => {
                        let Some(id) = info.get_property_val_str("id") else {
                            continue;
                        };
                        if id == node.device.id || id.len() != 64 {
                            continue;
                        }
                        let addresses: BTreeSet<_> = info
                            .get_addresses_v4()
                            .into_iter()
                            .filter(|ip| !ip.is_loopback() && local_address(IpAddr::V4(*ip)))
                            .map(|ip| SocketAddr::from((ip, info.get_port())))
                            .collect();
                        if addresses.is_empty() {
                            continue;
                        }
                        let name = info
                            .get_property_val_str("name")
                            .unwrap_or("附近设备")
                            .chars()
                            .take(80)
                            .collect();
                        names.insert(info.get_fullname().to_owned(), id.to_owned());
                        lock(&node.nearby).insert(
                            id.to_owned(),
                            Nearby {
                                name,
                                addresses: addresses.into_iter().take(8).collect(),
                            },
                        );
                    }
                    ServiceEvent::ServiceRemoved(_, name) => {
                        if let Some(id) = names.remove(&name) {
                            lock(&node.nearby).remove(&id);
                        }
                    }
                    _ => (),
                }
            }
        });
        *lock(&self.daemon) = Some(mdns);
        Ok(())
    }

    fn watch(self: &Arc<Self>) -> Result<()> {
        let weak = Arc::downgrade(self);
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                let (Some(node), Ok(event)) = (weak.upgrade(), event) else {
                    return;
                };
                if event.kind.is_access() {
                    return;
                }
                if let Ok(grants) = node.engine.store.list::<engine::Grant>("grants") {
                    let mut dirty = lock(&node.dirty);
                    for grant in grants {
                        if event.paths.iter().any(|p| {
                            p.strip_prefix(&grant.canonical).is_ok_and(|r| {
                                !r.iter()
                                    .any(|c| c.to_str().is_some_and(crate::files::ignored))
                            })
                        }) {
                            *dirty.entry(grant.id).or_default() += 1;
                        }
                    }
                }
            })?;
        for g in self.engine.store.list::<engine::Grant>("grants")? {
            let _ = watcher.watch(&g.canonical, RecursiveMode::Recursive);
        }
        *lock(&self.watcher) = Some(watcher);
        Ok(())
    }

    pub fn device(&self) -> Device {
        let addresses = if_addrs::get_if_addrs()
            .unwrap_or_default()
            .into_iter()
            .map(|interface| interface.ip())
            .filter(|ip| matches!(ip, IpAddr::V4(ip) if ip.is_private() || ip.is_link_local()))
            .map(|ip| SocketAddr::new(ip, self.device.port).to_string())
            .collect::<BTreeSet<_>>();
        Device {
            addresses: addresses.into_iter().collect(),
            ..self.device.clone()
        }
    }

    pub fn snapshot(&self) -> Result<Snapshot> {
        let tasks = self.engine.tasks()?;
        let peers = self.engine.store.list::<Peer>("peers")?;
        let seen = lock(&self.seen);
        let nearby = lock(&self.nearby);
        let reachable = lock(&self.reachable);
        Ok(Snapshot {
            device: self.device(),
            peers: peers
                .iter()
                .map(|peer| PeerView {
                    id: peer.id.clone(),
                    name: peer.name.clone(),
                    address: reachable
                        .get(&peer.id)
                        .or_else(|| nearby.get(&peer.id).and_then(|v| v.addresses.first()))
                        .map_or_else(|| peer.address.clone(), SocketAddr::to_string),
                    online: seen
                        .get(&peer.id)
                        .is_some_and(|last| last.elapsed() < Duration::from_secs(20)),
                })
                .collect(),
            nearby: nearby
                .iter()
                .filter(|(id, _)| !peers.iter().any(|peer| &peer.id == *id))
                .filter_map(|(id, device)| {
                    Some(PeerView {
                        id: id.clone(),
                        name: device.name.clone(),
                        address: device.addresses.first()?.to_string(),
                        online: true,
                    })
                })
                .collect(),
            pending: lock(&self.pending)
                .iter()
                .map(|p| PeerView {
                    id: p.peer.id.clone(),
                    name: p.peer.name.clone(),
                    address: p.peer.address.clone(),
                    online: true,
                })
                .collect(),
            dirty: tasks
                .iter()
                .filter(|t| {
                    lock(&self.dirty).contains_key(&t.local)
                        || lock(&self.remote_dirty)
                            .get(&t.peer)
                            .is_some_and(|ids| ids.contains(&t.remote))
                        || lock(&self.review_pending).contains(&t.id)
                })
                .map(|t| t.id.clone())
                .collect(),
            scan: lock(&self.scan_activity).clone().or_else(|| {
                let report = lock(&self.scan_report);
                let report = report.as_ref()?;
                if matches!(report.progress.phase, ScanPhase::Complete) {
                    return None;
                }
                let task = tasks.iter().find(|task| task.local == report.grant)?;
                Some(ScanActivity {
                    task: task.id.clone(),
                    local: Some(report.progress.clone()),
                    remote: None,
                    incoming: true,
                })
            }),
            tasks,
            execution: lock(&self.execution)
                .as_ref()
                .map(|log| log.summary.clone()),
            history: self.engine.history()?,
            phase: lock(&self.phase).clone().or_else(|| {
                lock(&self.incoming)
                    .as_ref()
                    .map(|_| "正在处理对端发起的批次".into())
            }),
            network_error: lock(&self.network_error).clone(),
            policy_states: self.engine.policy_views()?,
            paused_all: self.engine.all_paused()?,
            protocol: PROTOCOL,
            automatic_supported: false,
        })
    }

    pub fn invite(&self) -> Result<Code> {
        ensure!(lock(&self.pending).is_none(), "请先处理当前配对请求");
        let invite = Invite::new()?;
        let result = Code {
            code: invite.code().to_owned(),
            expires_at: invite.expires_at_ms() / 1000,
        };
        *lock(&self.approved) = None;
        *lock(&self.invite) = Some(invite);
        Ok(result)
    }

    pub fn answer_pair(&self, id: &str, accept: bool) -> Result<()> {
        let mut pending = lock(&self.pending);
        ensure!(
            pending.as_ref().is_some_and(|p| p.peer.id == id),
            "配对请求已过期"
        );
        let pending = pending.take().context("配对请求已过期")?;
        pending
            .answer
            .send(accept)
            .map_err(|_| anyhow::anyhow!("对方已断开"))
    }

    pub fn forget(&self, peer: &str) -> Result<()> {
        let _gate = lock(&self.engine.gate);
        ensure!(self.engine.active()?.is_none(), "请先核对未完成的批次");
        self.engine.store.delete("peers", peer)?;
        lock(&self.reachable).remove(peer);
        for grant in self
            .engine
            .store
            .list::<engine::Grant>("grants")?
            .into_iter()
            .filter(|g| g.peer == peer)
        {
            self.engine.store.delete("grants", &grant.id)?;
            let still_watched = self
                .engine
                .store
                .list::<engine::Grant>("grants")?
                .iter()
                .any(|other| other.canonical == grant.canonical);
            if !still_watched && let Some(watcher) = lock(&self.watcher).as_mut() {
                let _ = watcher.unwatch(&grant.canonical);
            }
            lock(&self.dirty).remove(&grant.id);
        }
        lock(&self.remote_dirty).remove(peer);
        for task in self.engine.tasks()?.into_iter().filter(|t| t.peer == peer) {
            self.engine.store.delete("tasks", &task.id)?;
        }
        Ok(())
    }

    fn peer(&self, id: &str) -> Result<Peer> {
        self.engine.store.get("peers", id)?.context("设备尚未配对")
    }

    async fn connect(addr: SocketAddr) -> Result<TcpStream> {
        ensure!(local_address(addr.ip()), "地址 {addr} 不在当前局域网内");
        timeout(Duration::from_secs(3), TcpStream::connect(addr))
            .await
            .map_err(|_| anyhow::anyhow!(
                "连接 {addr} 超时。请确认对端 SyncFu 正在运行，并在两端的「设置 → 权限检查」检查局域网权限"
            ))?
            .with_context(|| format!("无法连接 {addr}，请确认对端 SyncFu 正在运行"))
    }

    async fn greeting(tcp: &mut TcpStream) -> Result<Hello> {
        let hello: Hello = receive_small(tcp).await?;
        ensure!(
            hello.cert.len() < 8192 && hello.leaf.len() < 8192 && hello.name.chars().count() <= 80,
            "设备信息无效"
        );
        Ok(hello)
    }

    async fn probe_address(addr: SocketAddr) -> Result<Hello> {
        let mut tcp = Self::connect(addr).await?;
        timeout(Duration::from_secs(2), Self::greeting(&mut tcp))
            .await
            .map_err(|_| anyhow::anyhow!("{addr} 的 TCP 端口可达，但 SyncFu 没有响应"))?
            .with_context(|| format!("{addr} 的 TCP 端口可达，但返回的 SyncFu 信息无效"))
    }

    pub async fn check_listener(&self) -> Result<()> {
        let addr = SocketAddr::from(([127, 0, 0, 1], self.device.port));
        let hello = Self::probe_address(addr).await?;
        ensure!(
            hello.cert == self.identity.cert_der(),
            "本机端口未由 SyncFu 监听"
        );
        Ok(())
    }

    pub async fn probe_peer(&self, address: &str) -> Result<String> {
        let addr = parse_address(address)?;
        let hello = Self::probe_address(addr).await?;
        ensure!(
            hello.cert != self.identity.cert_der(),
            "请输入另一台设备的地址"
        );
        Ok(hello.name)
    }

    async fn open(
        &self,
        addr: SocketAddr,
        device_id: Option<&str>,
        peer: Option<&Peer>,
    ) -> Result<(TlsStream<TcpStream>, Hello)> {
        let mut tcp = Self::connect(addr).await?;
        tcp.set_nodelay(true)?;
        timeout(Duration::from_secs(6), async {
            let hello = Self::greeting(&mut tcp).await?;
            if let Some(peer) = peer {
                ensure!(
                    hello.cert == peer.cert && hello.leaf == peer.leaf,
                    "设备身份已改变，请重新配对"
                );
            }
            if let Some(id) = device_id {
                ensure!(
                    fingerprint(&hello.cert) == id,
                    "地址 {addr} 与所选设备的身份不符"
                );
            }
            let config = self.identity.client_config(&hello.cert, peer.is_some())?;
            let stream = TlsConnector::from(config)
                .connect(ServerName::try_from(SERVER_NAME)?, tcp)
                .await?;
            ensure!(
                stream
                    .get_ref()
                    .1
                    .peer_certificates()
                    .and_then(|chain| chain.first())
                    .is_some_and(|leaf| leaf.as_ref() == hello.leaf),
                "设备证书与握手不一致"
            );
            Ok((stream, hello))
        })
        .await
        .map_err(|_| anyhow::anyhow!("已连接 {addr}，但安全握手超时"))?
        .with_context(|| format!("无法与 {addr} 完成安全握手"))
    }

    fn discovered_addresses(&self, id: &str) -> Vec<SocketAddr> {
        lock(&self.nearby)
            .get(id)
            .map(|device| device.addresses.clone())
            .unwrap_or_default()
    }

    async fn open_candidates(
        &self,
        preferred: impl IntoIterator<Item = SocketAddr>,
        device_id: Option<&str>,
        peer: Option<&Peer>,
    ) -> Result<(SocketAddr, TlsStream<TcpStream>, Hello)> {
        let discovered = device_id
            .or_else(|| peer.map(|p| p.id.as_str()))
            .map(|id| self.discovered_addresses(id))
            .unwrap_or_default();
        let mut tried = BTreeSet::new();
        let mut errors = Vec::new();
        for addr in preferred.into_iter().chain(discovered) {
            if !tried.insert(addr) {
                continue;
            }
            match self.open(addr, device_id, peer).await {
                Ok((stream, hello)) => return Ok((addr, stream, hello)),
                Err(error) => errors.push(error),
            }
        }
        match errors.len() {
            0 => bail!("没有可用的局域网地址"),
            1 => Err(errors.remove(0)),
            _ => bail!(
                "无法连接设备。{}",
                errors
                    .iter()
                    .map(|error| format!("{error:#}"))
                    .collect::<Vec<_>>()
                    .join("；")
            ),
        }
    }

    async fn session(&self, peer: &Peer) -> Result<Session> {
        let last = lock(&self.reachable).get(&peer.id).copied();
        let (address, stream, _) = self
            .open_candidates(
                last.into_iter().chain([parse_address(&peer.address)?]),
                None,
                Some(peer),
            )
            .await?;
        lock(&self.reachable).insert(peer.id.clone(), address);
        Ok(Session(stream))
    }

    pub async fn pair(&self, address: &str, code: &str) -> Result<()> {
        self.pair_at(address, code, None).await
    }

    pub async fn pair_at(&self, address: &str, code: &str, device_id: Option<&str>) -> Result<()> {
        let (client, message) = ClientHandshake::start(code)?;
        let (connected, mut stream, hello) = self
            .open_candidates([parse_address(address)?], device_id, None)
            .await?;
        let session = hello.session.context("请在另一台设备点击“等待连接”")?;
        let cert = self.identity.cert_der().to_vec();
        let leaf = self.identity.leaf_der().to_vec();
        let exporter = stream.get_ref().1.export_keying_material(
            [0; 32],
            b"EXPORTER-Channel-Binding",
            None,
        )?;
        let binding = bound_context(
            &exporter,
            &hello.cert,
            &cert,
            &session,
            &hello.leaf,
            &leaf,
            &self.device.name,
            self.device.port,
        );
        send(
            &mut stream,
            &PairStart {
                cert,
                leaf,
                name: self.device.name.clone(),
                port: self.device.port,
                session,
                message,
            },
        )
        .await?;
        let response: std::result::Result<Vec<u8>, String> =
            timeout(Duration::from_secs(8), receive_small(&mut stream)).await??;
        let finalization = client
            .finish(&response.map_err(anyhow::Error::msg)?, &binding)
            .context("动态码错误或已失效")?;
        send(&mut stream, &finalization).await?;
        let reply: std::result::Result<(), String> =
            timeout(Duration::from_secs(120), receive_small(&mut stream))
                .await
                .context("配对确认超时")??;
        reply.map_err(anyhow::Error::msg)?;
        let peer = Peer {
            id: fingerprint(&hello.cert),
            name: hello.name,
            address: connected.to_string(),
            cert: hello.cert,
            leaf: hello.leaf,
        };
        ensure!(peer.id != self.device.id, "不能与本机配对");
        let (stream, _) = self.open(connected, None, Some(&peer)).await?;
        Session(stream).call::<BTreeSet<String>>(Rpc::Ping).await?;
        self.engine.store.put("peers", &peer.id, &peer)?;
        lock(&self.reachable).insert(peer.id.clone(), connected);
        lock(&self.seen).insert(peer.id, Instant::now());
        Ok(())
    }

    async fn serve(self: &Arc<Self>, mut socket: TcpStream, address: SocketAddr) -> Result<()> {
        socket.set_nodelay(true)?;
        let session = lock(&self.invite)
            .as_ref()
            .filter(|v| v.is_live())
            .map(|v| v.session_id().to_owned());
        let hello = Hello {
            cert: self.identity.cert_der().to_vec(),
            leaf: self.identity.leaf_der().to_vec(),
            name: self.device.name.clone(),
            session,
        };
        timeout(Duration::from_secs(5), send(&mut socket, &hello)).await??;
        let peers = self.engine.store.list::<Peer>("peers")?;
        let approved = lock(&self.approved)
            .clone()
            .filter(|(_, until)| *until > Instant::now());
        let roots = peers
            .iter()
            .chain(approved.iter().map(|(peer, _)| peer))
            .map(|peer| peer.cert.clone())
            .collect::<Vec<_>>();
        let config = self
            .identity
            .server_config(&roots, hello.session.is_some())?;
        let mut stream = timeout(
            Duration::from_secs(8),
            TlsAcceptor::from(config).accept(socket),
        )
        .await??;
        let leaf = stream
            .get_ref()
            .1
            .peer_certificates()
            .and_then(|c| c.first());
        let authenticated =
            leaf.and_then(|leaf| peers.into_iter().find(|p| p.leaf == leaf.as_ref()));
        if let Some(peer) = authenticated {
            let activity = Incoming::new(&self.incoming, &self.execution);
            loop {
                let request: Rpc =
                    framing::receive_request(&mut stream, PROTOCOL, SCAN_TIMEOUT).await?;
                if self.peer(&peer.id).is_err() {
                    bail!("授权已撤销");
                }
                lock(&self.seen).insert(peer.id.clone(), Instant::now());
                let begin = match &request {
                    Rpc::Begin { work, .. } => Some(work.batch.id.clone()),
                    _ => None,
                };
                let finish = match &request {
                    Rpc::Finish { ticket, .. } => Some(ticket.id.clone()),
                    _ => None,
                };
                let node = self.clone();
                let peer_id = peer.id.clone();
                let answer: Reply =
                    tokio::task::spawn_blocking(move || node.rpc(&peer_id, request))
                        .await?
                        .map_err(|e| format!("{e:#}"));
                if answer.is_ok() {
                    if let Some(id) = begin {
                        activity.begin(id);
                    }
                    if let Some(id) = finish {
                        activity.finish(&id);
                    }
                }
                send(&mut stream, &answer).await?;
            }
        }
        if let Some((candidate, _)) = approved
            && leaf.is_some_and(|leaf| candidate.leaf == leaf.as_ref())
        {
            let request: Rpc =
                timeout(Duration::from_secs(6), receive_small(&mut stream)).await??;
            ensure!(matches!(request, Rpc::Ping), "配对尚未完成");
            {
                let mut approved = lock(&self.approved);
                ensure!(
                    approved
                        .as_ref()
                        .is_some_and(|(p, until)| p.id == candidate.id
                            && p.leaf == candidate.leaf
                            && *until > Instant::now()),
                    "配对已失效"
                );
                self.engine.store.put("peers", &candidate.id, &candidate)?;
                lock(&self.seen).insert(candidate.id, Instant::now());
                *approved = None;
            }
            let reply: Reply = Ok(serde_json::json!([]));
            send(&mut stream, &reply).await?;
            return Ok(());
        }
        ensure!(leaf.is_none() && hello.session.is_some(), "设备身份未授权");
        let request: PairStart =
            timeout(Duration::from_secs(8), receive_small(&mut stream)).await??;
        ensure!(
            request.cert.len() < 8192
                && request.leaf.len() < 8192
                && request.name.chars().count() <= 80
                && request.port != 0,
            "配对信息无效"
        );
        let peer = Peer {
            id: fingerprint(&request.cert),
            name: request.name,
            address: SocketAddr::new(address.ip(), request.port).to_string(),
            cert: request.cert,
            leaf: request.leaf,
        };
        ensure!(peer.id != self.device.id, "不能与本机配对");
        let exporter = stream.get_ref().1.export_keying_material(
            [0; 32],
            b"EXPORTER-Channel-Binding",
            None,
        )?;
        let binding = bound_context(
            &exporter,
            &hello.cert,
            &peer.cert,
            &request.session,
            &hello.leaf,
            &peer.leaf,
            &peer.name,
            request.port,
        );
        let start = lock(&self.invite).as_mut().context("动态码已过期")?.begin(
            &request.session,
            &request.message,
            &binding,
        );
        let (handshake, response) = match start {
            Ok(value) => value,
            Err(e) => {
                send(&mut stream, &Err::<Vec<u8>, _>(e.to_string())).await?;
                return Ok(());
            }
        };
        let exchange = async {
            send(&mut stream, &Ok::<_, String>(response)).await?;
            receive_small::<Vec<u8>>(&mut stream).await
        };
        match timeout(Duration::from_secs(12), exchange).await {
            Ok(Ok(finalization)) => lock(&self.invite)
                .as_mut()
                .context("动态码已过期")?
                .finish(handshake, &finalization)?,
            _ => {
                if let Some(invite) = lock(&self.invite).as_mut() {
                    invite.cancel_attempt(handshake);
                }
                bail!("配对认证超时");
            }
        }
        *lock(&self.invite) = None;
        let (answer, rx) = oneshot::channel();
        {
            let mut pending = lock(&self.pending);
            ensure!(pending.is_none(), "已有配对请求");
            *pending = Some(Pending {
                peer: peer.clone(),
                answer,
            });
        }
        let accepted = tokio::select! {
            result = timeout(Duration::from_secs(110), rx) => matches!(result, Ok(Ok(true))),
            _ = stream.read_u8() => false,
        };
        {
            let mut pending = lock(&self.pending);
            if pending.as_ref().is_some_and(|p| p.peer.id == peer.id) {
                pending.take();
            }
        }
        if !accepted {
            send(&mut stream, &Err::<(), _>("配对被拒绝或已超时")).await?;
            return Ok(());
        }
        *lock(&self.approved) = Some((peer, Instant::now() + Duration::from_secs(15)));
        send(&mut stream, &Ok::<(), String>(())).await?;
        Ok(())
    }

    pub fn local_folders(&self, peer: &str) -> Result<Vec<Folder>> {
        self.peer(peer)?;
        self.engine.grants(peer)
    }

    pub async fn folders(&self, peer: &str) -> Result<FolderList> {
        let mut remote = self.session(&self.peer(peer)?).await?;
        Ok(FolderList {
            local: self.engine.grants(peer)?,
            remote: remote.call(Rpc::Folders).await?,
        })
    }

    pub fn grant(&self, peer: &str, path: &Path) -> Result<Folder> {
        self.peer(peer)?;
        let grant = self.engine.grant(peer, path)?;
        if let Some(watcher) = lock(&self.watcher).as_mut()
            && let Err(error) = watcher.watch(&grant.canonical, RecursiveMode::Recursive)
        {
            *lock(&self.network_error) = Some(format!("后台检测未启动：{error}"));
        }
        Ok(grant.into())
    }

    pub fn revoke(&self, id: &str) -> Result<()> {
        let grant = self.engine.store.get::<engine::Grant>("grants", id)?;
        self.engine.revoke_grant(id)?;
        if let Some(grant) = grant
            && let Some(watcher) = lock(&self.watcher).as_mut()
        {
            let _ = watcher.unwatch(&grant.canonical);
        }
        Ok(())
    }

    pub async fn create_task(
        &self,
        peer_id: &str,
        local_id: &str,
        remote_id: &str,
    ) -> Result<Task> {
        let peer = self.peer(peer_id)?;
        ensure!(
            !self
                .engine
                .tasks()?
                .iter()
                .any(|t| t.local == local_id && t.remote != remote_id),
            "本机目录已关联其他任务"
        );
        let folders = self.folders(peer_id).await?;
        let local = folders
            .local
            .into_iter()
            .find(|folder| folder.id == local_id)
            .context("请选择已授权的本机文件夹")?;
        let remote = folders
            .remote
            .into_iter()
            .find(|folder| folder.id == remote_id)
            .context("请在另一台设备授权文件夹")?;
        let task = Task {
            id: pair_key(local_id, remote_id)?,
            peer: peer.id.clone(),
            local: local.id,
            remote: remote.id,
            label: local.label,
            local_path: local.path,
            remote_path: remote.path,
        };
        let mirrored = Task {
            id: task.id.clone(),
            peer: self.device.id.clone(),
            local: task.remote.clone(),
            remote: task.local.clone(),
            label: remote.label,
            local_path: task.remote_path.clone(),
            remote_path: task.local_path.clone(),
        };
        self.session(&peer)
            .await?
            .call::<()>(Rpc::Link(mirrored))
            .await?;
        self.engine.link_task(&task)?;
        Ok(task)
    }

    pub fn task_policy(&self, task: &str) -> Result<PolicyView> {
        self.engine.task(task)?;
        Ok(PolicyView {
            task: task.into(),
            state: self.engine.policy_state(task)?,
            paused: self.engine.is_paused(task)?,
        })
    }
    pub fn pause_task(&self, task: &str, paused: bool) -> Result<()> {
        self.engine.set_paused(Some(task), paused)
    }
    pub fn pause_all(&self, paused: bool) -> Result<()> {
        self.engine.set_paused(None, paused)
    }
    pub async fn propose_policy(
        self: &Arc<Self>,
        task: &str,
        expected_revision: u32,
        next: TaskPolicy,
    ) -> Result<PolicyState> {
        let _coordinator = self.coordinator.try_lock().context("请先结束当前操作")?;
        ensure!(next.task == task, "策略不属于此任务");
        let proposal = Proposal {
            id: engine::id(),
            expected_revision,
            next,
            proposed_by: self.device.id.clone(),
        };
        let _: PolicyState = self.local(Rpc::OfferPolicy(proposal.clone())).await?;
        let linked = self.engine.task(task)?;
        let mut remote = self
            .session(&self.peer(&linked.peer)?)
            .await
            .context("提案已在本端保存，请重连后核对")?;
        let _: PolicyState = remote.call(Rpc::OfferPolicy(proposal)).await?;
        self.sync_policy(task, &mut remote).await
    }
    pub async fn answer_policy(
        self: &Arc<Self>,
        task: &str,
        proposal: &str,
        accept: bool,
    ) -> Result<PolicyState> {
        let _coordinator = self.coordinator.try_lock().context("请先结束当前操作")?;
        let node = self.clone();
        let task_id = task.to_owned();
        let proposal_id = proposal.to_owned();
        tokio::task::spawn_blocking(move || {
            node.engine.answer_policy(&task_id, &proposal_id, accept)
        })
        .await??;
        let linked = self.engine.task(task)?;
        let mut remote = self
            .session(&self.peer(&linked.peer)?)
            .await
            .context("答复已在本端保存，请重连后核对")?;
        self.sync_policy(task, &mut remote).await
    }
    pub async fn reconcile_policy(self: &Arc<Self>, task: &str) -> Result<PolicyState> {
        let _coordinator = self.coordinator.try_lock().context("请先结束当前操作")?;
        let linked = self.engine.task(task)?;
        let mut remote = self.session(&self.peer(&linked.peer)?).await?;
        self.sync_policy(task, &mut remote).await
    }
    async fn sync_policy(
        self: &Arc<Self>,
        task: &str,
        remote: &mut Session,
    ) -> Result<PolicyState> {
        let mut local = self.engine.policy_state(task)?;
        let mut other: PolicyState = remote.call(Rpc::Policy(task.into())).await?;
        let proposal = local
            .pending
            .as_ref()
            .or(other.pending.as_ref())
            .map(|p| p.proposal.clone());
        let Some(proposal) = proposal else {
            ensure!(
                local.current == other.current,
                "两端策略不一致，需要人工核对"
            );
            return Ok(local);
        };
        let hash = proposal.fingerprint()?;
        for state in [&local, &other] {
            if let Some(pending) = &state.pending {
                ensure!(pending.proposal == proposal, "两端存在不同策略提案");
            }
        }
        if let Some(receipt) = other
            .last_receipt
            .as_ref()
            .filter(|r| r.proposal == proposal.id && r.outcome == ReceiptOutcome::Rejected)
        {
            ensure!(receipt.digest == hash, "拒绝凭据摘要不符");
            if local.pending.is_some() {
                return self
                    .local(Rpc::RejectPolicy {
                        task: task.into(),
                        receipt: receipt.clone(),
                    })
                    .await;
            }
            return Ok(local);
        }
        if let Some(receipt) = local
            .last_receipt
            .as_ref()
            .filter(|r| r.proposal == proposal.id && r.outcome == ReceiptOutcome::Rejected)
        {
            ensure!(receipt.digest == hash, "拒绝凭据摘要不符");
            let _: PolicyState = remote
                .call(Rpc::RejectPolicy {
                    task: task.into(),
                    receipt: receipt.clone(),
                })
                .await?;
            return Ok(local);
        }
        let committed = |state: &PolicyState| {
            state.last_receipt.as_ref().is_some_and(|r| {
                r.proposal == proposal.id
                    && r.digest == hash
                    && r.outcome == ReceiptOutcome::Committed
            })
        };
        if local.pending.is_none() && !committed(&local) {
            ensure!(
                proposal.proposed_by != self.device.id,
                "本端提案记录缺失，不能从对端推断本机已同意"
            );
            local = self.local(Rpc::OfferPolicy(proposal.clone())).await?;
        }
        if other.pending.is_none() && !committed(&other) {
            ensure!(
                proposal.proposed_by == self.device.id,
                "对端提案记录缺失，需要在对端核对"
            );
            other = remote.call(Rpc::OfferPolicy(proposal.clone())).await?;
        }
        let accepted = |state: &PolicyState| {
            committed(state)
                || state
                    .pending
                    .as_ref()
                    .is_some_and(|p| p.proposal.id == proposal.id && p.accepted)
        };
        if !accepted(&local) || !accepted(&other) {
            return Ok(local);
        }
        let other: PolicyState = remote
            .call(Rpc::CommitPolicy {
                task: task.into(),
                proposal: proposal.id.clone(),
                digest: hash.clone(),
            })
            .await?;
        let local: PolicyState = self
            .local(Rpc::CommitPolicy {
                task: task.into(),
                proposal: proposal.id.clone(),
                digest: hash.clone(),
            })
            .await?;
        ensure!(local.current == other.current, "提交后的策略不一致");
        let _: PolicyState = remote
            .call(Rpc::ConfirmPolicy {
                task: task.into(),
                proposal: proposal.id.clone(),
                digest: hash.clone(),
            })
            .await?;
        self.local(Rpc::ConfirmPolicy {
            task: task.into(),
            proposal: proposal.id,
            digest: hash,
        })
        .await
    }
    pub async fn inspect(self: &Arc<Self>, task_id: &str) -> Result<Plan> {
        let _coordinator = self.coordinator.try_lock().context("请先结束当前操作")?;
        ensure!(self.engine.active()?.is_none(), "请先核对未完成的批次");
        let task = self.engine.task(task_id)?;
        let _phase = Phase::new(&self.phase, "正在扫描和校验文件");
        let _scan = ScanActivityGuard::new(&self.scan_activity, &task.id);
        let mut session = self.session(&self.peer(&task.peer)?).await?;
        let (a, b, expected) = self.manifests(&task, &mut session).await?;
        let policy = self.engine.policy_state(&task.id)?.ready()?.clone();
        let comparison = policy.compare(&a, &b, &expected.base, &self.device.id)?;
        let facts = BTreeMap::from([
            (
                self.device.id.clone(),
                ManifestProof::new(&policy.filter(&a))?,
            ),
            (task.peer.clone(), ManifestProof::new(&policy.filter(&b))?),
        ]);
        let common: Baseline = a
            .entries
            .iter()
            .filter(|(p, e)| {
                !policy.is_excluded(p)
                    && b.entries.get(*p) == Some(*e)
                    && !expected.base.contains_key(*p)
            })
            .map(|(p, e)| (p.clone(), Some(e.clone())))
            .collect();
        if comparison.changes.is_empty() && comparison.issues.is_empty() && !common.is_empty() {
            session
                .call::<()>(Rpc::Observe {
                    task: task.id.clone(),
                    expected: expected.clone(),
                    common: common.clone(),
                })
                .await?;
            self.observe(&task.id, &expected, &common)?;
        }
        if comparison.changes.is_empty() && comparison.issues.is_empty() {
            lock(&self.review_pending).remove(&task.id);
        } else {
            lock(&self.review_pending).insert(task.id.clone());
        }
        self.cache_plan(task, comparison, expected, common, None, (policy, facts))
    }

    async fn manifests(
        self: &Arc<Self>,
        task: &Task,
        session: &mut Session,
    ) -> Result<(Manifest, Manifest, PairState)> {
        let local_policy = self.engine.policy_state(&task.id)?;
        let other_policy: PolicyState = session.call(Rpc::Policy(task.id.clone())).await?;
        ensure!(
            local_policy.ready()? == other_policy.ready()?,
            "两端策略不一致，请先核对"
        );
        let expected = self.engine.pair_state(&task.id)?;
        let remote_state: PairState = session.call(Rpc::State(task.id.clone())).await?;
        ensure!(
            remote_state.stamps == expected.stamps,
            "两端同步历史需要核对"
        );
        let mut expected = expected;
        for (path, state) in &remote_state.base {
            if let Some(previous) = expected.base.get(path) {
                ensure!(previous == state, "两端同步历史需要核对");
            } else {
                expected.base.insert(path.clone(), state.clone());
            }
        }
        let local_state = self.engine.pair_state(&task.id)?;
        if local_state != expected {
            self.observe(&task.id, &local_state, &expected.base)?;
        }
        if remote_state != expected {
            session
                .call::<()>(Rpc::Observe {
                    task: task.id.clone(),
                    expected: remote_state,
                    common: expected.base.clone(),
                })
                .await?;
        }
        let node = self.clone();
        let local = task.clone();
        let scan = tokio::task::spawn_blocking(move || {
            node.scan_grant(&local.local, &local.peer, Some(&local.id))
        });
        // Status is optional and read-only: older peers still support the existing
        // Scan request. Never let a missing progress channel fail a valid scan.
        let progress_session = timeout(Duration::from_secs(3), async {
            let mut status = self.session(&self.peer(&task.peer)?).await?;
            let previous: Option<GrantScanReport> =
                status.call(Rpc::ScanStatus(task.remote.clone())).await?;
            Ok::<_, anyhow::Error>((status, previous.map(|report| report.id)))
        })
        .await
        .ok()
        .and_then(Result::ok);
        let monitor = async {
            if let Some((mut status, previous)) = progress_session {
                loop {
                    tokio::time::sleep(Duration::from_millis(400)).await;
                    let report = timeout(
                        Duration::from_secs(3),
                        status
                            .call::<Option<GrantScanReport>>(Rpc::ScanStatus(task.remote.clone())),
                    )
                    .await;
                    match report {
                        Ok(Ok(Some(report))) if Some(&report.id) != previous.as_ref() => {
                            if let Some(activity) = lock(&self.scan_activity)
                                .as_mut()
                                .filter(|activity| activity.task == task.id)
                            {
                                activity.remote = Some(report.progress);
                            }
                        }
                        Ok(Ok(_)) => (),
                        _ => break,
                    }
                }
            }
            std::future::pending::<()>().await;
        };
        let remote_scan = async {
            tokio::select! {
                result = session.call::<Manifest>(Rpc::Scan(task.remote.clone())) => result,
                _ = monitor => unreachable!(),
            }
        };
        // Await both sides, including on error, so a failed remote request cannot
        // leave an abandoned local scan running behind a new inspection.
        let (local, remote) = tokio::join!(scan, remote_scan);
        let local = local??;
        let remote = remote?;
        if let Some(activity) = lock(&self.scan_activity).as_mut() {
            let files = remote
                .entries
                .values()
                .filter(|entry| matches!(entry, Entry::File { .. }))
                .count() as u64;
            activity.remote = Some(ScanProgress {
                phase: ScanPhase::Complete,
                current_path: String::new(),
                directories: remote.entries.len() as u64 - files,
                files_total: files,
                files_hashed: files,
                discovery_complete: remote.issues.is_empty(),
                queued_files: 0,
                bytes_hashed: remote.entries.values().fold(0u64, |total, entry| {
                    total.saturating_add(match entry {
                        Entry::File { bytes, .. } => *bytes,
                        _ => 0,
                    })
                }),
            });
        }
        if remote.issues.is_empty()
            && let Some(ids) = lock(&self.remote_dirty).get_mut(&task.peer)
        {
            ids.remove(&task.remote);
        }
        Ok((local, remote, expected))
    }

    fn scan_grant(&self, grant: &str, peer: &str, task: Option<&str>) -> Result<Manifest> {
        // Bound process-wide scan descriptors even when several peers ask at once.
        let _scan_gate = lock(&self.scan_gate);
        let epoch = lock(&self.dirty).get(grant).copied();
        let root = self.engine.root(grant, peer)?;
        let id = uuid::Uuid::new_v4().to_string();
        let manifest = root.scan_with_progress(|progress| {
            *lock(&self.scan_report) = Some(GrantScanReport {
                grant: grant.into(),
                id: id.clone(),
                progress: progress.clone(),
            });
            if let Some(task) = task
                && let Some(activity) = lock(&self.scan_activity)
                    .as_mut()
                    .filter(|activity| activity.task == task)
            {
                activity.local = Some(progress.clone());
            }
        });
        let mut dirty = lock(&self.dirty);
        if manifest.issues.is_empty() && dirty.get(grant).copied() == epoch {
            dirty.remove(grant);
        }
        Ok(manifest)
    }

    fn observe(&self, task: &str, expected: &PairState, common: &Baseline) -> Result<()> {
        let _gate = lock(&self.engine.gate);
        let mut state = self.engine.pair_state(task)?;
        ensure!(
            self.engine.active()?.is_none() && &state == expected,
            "基线已变化，请重新检查"
        );
        for (p, v) in common {
            state.base.entry(p.clone()).or_insert_with(|| v.clone());
        }
        self.engine.store.put("baseline", task, &state)
    }

    fn cache_plan(
        &self,
        task: Task,
        comparison: Comparison,
        expected: PairState,
        common: Baseline,
        undo_of: Option<String>,
        proof: (TaskPolicy, BTreeMap<String, ManifestProof>),
    ) -> Result<Plan> {
        let (policy, facts) = proof;
        let mut comparison = comparison;
        let original_changes = comparison.changes.clone();
        let conflicts = if undo_of.is_none() {
            conflicts::describe(&policy, &self.device.id, &comparison)?
        } else {
            vec![]
        };
        let conflict_fingerprints: BTreeMap<_, _> = conflicts
            .iter()
            .map(|c| (c.path.as_str(), c.fingerprint.as_str()))
            .collect();
        let review_notes = self
            .engine
            .review_notes(&task.id)?
            .into_iter()
            .filter(|note| {
                conflict_fingerprints.get(note.path.as_str()) == Some(&note.fingerprint.as_str())
            })
            .collect::<Vec<_>>();
        let ignored: BTreeSet<_> = review_notes
            .iter()
            .filter(|note| note.ignored)
            .map(|note| note.path.as_str())
            .collect();
        comparison
            .changes
            .retain(|c| !ignored.contains(c.path.as_str()));
        let id = engine::id();
        let policy_digest = policy.fingerprint()?;
        ensure!(
            self.engine.policy_state(&task.id)?.ready()?.fingerprint()? == policy_digest,
            "扫描期间策略已变化"
        );
        let digest = digest(&(
            &id,
            &task.id,
            &comparison.changes,
            &expected,
            &undo_of,
            &policy_digest,
            &facts,
            &conflicts,
            &review_notes,
        ))?;
        let plan = Plan {
            id,
            task,
            comparison,
            digest,
            undo_of,
            policy: PolicyStamp {
                revision: policy.revision,
                digest: policy_digest,
            },
            facts,
            original_changes,
            conflicts,
            resolutions: vec![],
            review_notes,
            baseline: expected.base.clone(),
            common,
        };
        let mut cache = lock(&self.plans);
        if cache.len() >= 16
            && let Some(key) = cache.keys().next().cloned()
        {
            cache.remove(&key);
        }
        cache.insert(plan.id.clone(), (plan.clone(), expected));
        Ok(plan)
    }

    pub async fn resolve_plan(
        self: &Arc<Self>,
        plan_id: &str,
        expected_digest: &str,
        requests: Vec<DecisionRequest>,
    ) -> Result<Plan> {
        let _coordinator = self.coordinator.try_lock().context("请先结束当前操作")?;
        ensure!(!requests.is_empty(), "请选择需要处理的冲突");
        let (mut plan, expected) = lock(&self.plans)
            .get(plan_id)
            .cloned()
            .context("预览已过期")?;
        ensure!(
            plan.digest == expected_digest
                && plan.undo_of.is_none()
                && plan.comparison.issues.is_empty(),
            "不能更改此预览的冲突决策"
        );
        let policy = self.engine.policy_state(&plan.task.id)?.ready()?.clone();
        ensure!(policy.fingerprint()? == plan.policy.digest, "策略已变化");
        let mut session = self.session(&self.peer(&plan.task.peer)?).await?;
        let (a, b, current) = self.manifests(&plan.task, &mut session).await?;
        ensure!(current == expected, "基线已变化");
        for (device, manifest) in [(&self.device.id, &a), (&plan.task.peer, &b)] {
            ensure!(
                plan.facts
                    .get(device)
                    .is_some_and(|fact| ManifestProof::new(&policy.filter(manifest))
                        .is_ok_and(|now| now.digest == fact.digest)),
                "冲突内容已变化，请重新检查"
            );
        }
        let mut seen = BTreeSet::new();
        for request in &requests {
            ensure!(seen.insert(&request.path), "重复的冲突决定");
        }
        plan.resolutions
            .retain(|r| !seen.contains(&r.conflict.path));
        plan.review_notes.retain(|n| !seen.contains(&n.path));
        let conflicts_by_path: BTreeMap<_, _> = plan
            .conflicts
            .iter()
            .map(|c| (c.path.as_str(), c))
            .collect();
        for request in &requests {
            let conflict = (*conflicts_by_path
                .get(request.path.as_str())
                .context("路径不是此预览的冲突")?)
            .clone();
            match &request.decision {
                Decision::Use { source_device } => {
                    ensure!(policy.can_manage(&self.device.id), "此端不能批准冲突覆盖");
                    let resolution = ConflictResolution {
                        conflict,
                        source_device: source_device.clone(),
                    };
                    resolution.change(&policy, &self.device.id)?;
                    plan.resolutions.push(resolution);
                }
                Decision::Later | Decision::IgnoreVersion => {
                    plan.review_notes.push(ReviewNote {
                        task: plan.task.id.clone(),
                        path: conflict.path,
                        fingerprint: conflict.fingerprint,
                        ignored: matches!(request.decision, Decision::IgnoreVersion),
                    });
                }
            }
        }
        plan.comparison.changes = plan.original_changes.clone();
        let mut resolved_changes = BTreeMap::new();
        for resolution in &plan.resolutions {
            let change = resolution.change(&policy, &self.device.id)?;
            resolved_changes.insert(change.path.clone(), change);
        }
        for change in &mut plan.comparison.changes {
            if let Some(resolved) = resolved_changes.remove(&change.path) {
                *change = resolved;
            }
        }
        let ignored: BTreeSet<_> = plan
            .review_notes
            .iter()
            .filter(|n| n.ignored)
            .map(|n| n.path.as_str())
            .collect();
        plan.comparison
            .changes
            .retain(|c| !ignored.contains(c.path.as_str()));
        self.engine.save_review_notes(
            &plan.task.id,
            &requests.iter().map(|r| r.path.clone()).collect::<Vec<_>>(),
            &plan.review_notes,
        )?;
        plan.id = engine::id();
        plan.digest = digest(&(
            &plan.id,
            &plan.task.id,
            &plan.comparison.changes,
            &expected,
            &plan.policy.digest,
            &plan.facts,
            &plan.resolutions,
            &plan.review_notes,
        ))?;
        let mut plans = lock(&self.plans);
        plans.remove(plan_id);
        plans.insert(plan.id.clone(), (plan.clone(), expected));
        Ok(plan)
    }
    pub fn clear_review_note(&self, task: &str, path: &str) -> Result<()> {
        self.engine.clear_review_note(task, path)?;
        lock(&self.plans).retain(|_, (plan, _)| plan.task.id != task);
        Ok(())
    }
    pub async fn preview_conflict(
        self: &Arc<Self>,
        plan_id: &str,
        expected_digest: &str,
        path: &str,
    ) -> Result<ConflictPreview> {
        let (plan, _) = lock(&self.plans)
            .get(plan_id)
            .cloned()
            .context("预览已过期")?;
        ensure!(
            plan.digest == expected_digest && plan.undo_of.is_none(),
            "冲突预览无效"
        );
        let conflict = plan
            .conflicts
            .iter()
            .find(|c| c.path == path)
            .context("路径不是此计划的冲突")?;
        let make = |device: &str| -> Result<PreviewRequest> {
            Ok(PreviewRequest {
                task: plan.task.id.clone(),
                path: path.into(),
                policy_digest: plan.policy.digest.clone(),
                expected: conflict
                    .versions
                    .get(device)
                    .context("缺少端点版本")?
                    .clone(),
            })
        };
        let local_request = make(&self.device.id)?;
        let remote_request = make(&plan.task.peer)?;
        let node = self.clone();
        let peer_id = plan.task.peer.clone();
        let local =
            tokio::task::spawn_blocking(move || node.engine.read_preview(&local_request, &peer_id))
                .await??;
        let remote_expected = remote_request.expected.clone();
        let remote = self
            .session(&self.peer(&plan.task.peer)?)
            .await?
            .call(Rpc::PreviewFile(remote_request))
            .await?;
        conflicts::validate_preview(&remote, &plan.task.peer, &remote_expected)?;
        Ok(ConflictPreview {
            path: path.into(),
            versions: vec![local, remote],
        })
    }

    pub async fn inspect_undo(self: &Arc<Self>, batch_id: &str) -> Result<Plan> {
        let _coordinator = self.coordinator.try_lock().context("请先结束当前操作")?;
        ensure!(self.engine.active()?.is_none(), "请先核对未完成的批次");
        let old = self
            .engine
            .history()?
            .into_iter()
            .find(|b| b.id == batch_id && b.undo_available)
            .context("此批次没有可用的备份")?;
        let work = self.engine.work(batch_id)?;
        let task = self.engine.task(&old.task)?;
        let _phase = Phase::new(&self.phase, "正在检查可撤销的文件");
        let _scan = ScanActivityGuard::new(&self.scan_activity, &task.id);
        let mut session = self.session(&self.peer(&task.peer)?).await?;
        let (a, b, expected) = self.manifests(&task, &mut session).await?;
        let policy = self.engine.policy_state(&task.id)?.ready()?.clone();
        let facts = BTreeMap::from([
            (
                self.device.id.clone(),
                ManifestProof::new(&policy.filter(&a))?,
            ),
            (task.peer.clone(), ManifestProof::new(&policy.filter(&b))?),
        ]);
        let applied = self
            .engine
            .applied(batch_id)?
            .into_iter()
            .collect::<BTreeSet<_>>();
        let originals: BTreeMap<_, _> = work
            .ops
            .iter()
            .filter(|o| applied.contains(&o.id))
            .map(|o| (o.change.path.as_str(), o))
            .collect();
        let mut comparison = Comparison {
            changes: vec![],
            same: 0,
            total: 0,
            ignored: 0,
            issues: a.issues.iter().chain(&b.issues).cloned().collect(),
        };
        for op in originals.values() {
            let c = &op.change;
            let target = if c.target == 0 {
                &a.entries
            } else {
                &b.entries
            };
            let safe = a.entries.get(&c.path) == c.after.as_ref()
                && b.entries.get(&c.path) == c.after.as_ref()
                && expected.stamps.get(&c.path).is_some_and(|s| s == batch_id)
                && !(c.before.is_none()
                    && c.after == Some(Entry::Directory)
                    && target.keys().any(|p| {
                        child_of(p, &c.path)
                            && !originals.get(p.as_str()).is_some_and(|o| {
                                o.change.target == c.target
                                    && o.change.before.is_none()
                                    && o.change.after.as_ref() == target.get(p)
                                    && expected.stamps.get(p).is_some_and(|s| s == batch_id)
                            })
                    }));
            let action = if !safe {
                Action::Conflict
            } else if c.before.is_none() {
                Action::Delete
            } else if c.after.is_none() {
                Action::Create
            } else {
                Action::Update
            };
            let mut change = Change {
                path: c.path.clone(),
                target: c.target,
                action,
                before: c.after.clone(),
                after: c.before.clone(),
            };
            if change.action != Action::Conflict
                && policy
                    .validate_change(&change, &self.device.id, true)
                    .is_err()
            {
                change.action = Action::Conflict;
            }
            comparison.changes.push(change);
        }
        self.cache_plan(
            task,
            comparison,
            expected,
            BTreeMap::new(),
            Some(batch_id.into()),
            (policy, facts),
        )
    }

    fn prepare_work(
        &self,
        plan_id: &str,
        digest_value: &str,
        selected: Vec<String>,
    ) -> Result<(Plan, PairState, Work)> {
        let (plan, expected) = lock(&self.plans)
            .get(plan_id)
            .cloned()
            .context("预览已过期，请重新检查")?;
        ensure!(
            plan.digest == digest_value && plan.comparison.issues.is_empty(),
            "预览未通过安全检查"
        );
        ensure!(
            self.engine
                .policy_state(&plan.task.id)?
                .ready()?
                .fingerprint()?
                == plan.policy.digest,
            "策略已变化，请重新检查"
        );
        let count = selected.len();
        let mut selected: BTreeSet<_> = selected.into_iter().collect();
        ensure!(count == selected.len() && count > 0, "请选择需要执行的项目");
        let indexed = plan
            .comparison
            .changes
            .iter()
            .map(|change| (change.path.clone(), change))
            .collect::<BTreeMap<_, _>>();
        ensure!(
            selected.iter().all(|path| indexed
                .get(path)
                .is_some_and(|c| c.action != Action::Conflict)),
            "选择包含未决定的冲突或无效路径"
        );
        let mut queue = selected
            .iter()
            .cloned()
            .collect::<std::collections::VecDeque<_>>();
        while let Some(path) = queue.pop_front() {
            let change = indexed.get(&path).context("选择路径遗失")?;
            if change.after.is_some() {
                for (i, _) in path.match_indices('/') {
                    let parent = &path[..i];
                    if indexed.get(parent).is_some_and(|c| {
                        c.target == change.target && c.after == Some(Entry::Directory)
                    }) && selected.insert(parent.into())
                    {
                        queue.push_back(parent.into());
                    }
                }
            }
            if change.before == Some(Entry::Directory) && change.after.is_none() {
                let prefix = format!("{path}/");
                for (child, c) in indexed
                    .range(prefix.clone()..)
                    .take_while(|(p, _)| p.starts_with(&prefix))
                {
                    if c.target == change.target
                        && c.action == Action::Delete
                        && selected.insert(child.clone())
                    {
                        queue.push_back(child.clone());
                    }
                }
            }
        }
        let count = selected.len();
        let original = plan
            .undo_of
            .as_deref()
            .map(|id| self.engine.work(id))
            .transpose()?;
        let original_ops = original.as_ref().map(|w| {
            w.ops
                .iter()
                .map(|o| (o.change.path.as_str(), o))
                .collect::<BTreeMap<_, _>>()
        });
        let mut ops: Vec<_> = plan
            .comparison
            .changes
            .iter()
            .filter(|c| c.action != Action::Conflict && selected.contains(&c.path))
            .map(|c| {
                let previous = original_ops
                    .as_ref()
                    .and_then(|ops| ops.get(c.path.as_str()))
                    .map(|op| (op.previous_known, op.previous.clone()))
                    .unwrap_or_else(|| {
                        (
                            plan.baseline.contains_key(&c.path),
                            plan.baseline.get(&c.path).cloned().flatten(),
                        )
                    });
                Operation {
                    id: engine::id(),
                    change: c.clone(),
                    previous_known: previous.0,
                    previous: previous.1,
                }
            })
            .collect();
        ensure!(ops.len() == count, "选择包含未批准或冲突的文件");
        ops.sort_by(|a, b| a.id.cmp(&b.id));
        engine::require_selected_dependencies(&ops)?;
        let batch = Batch {
            id: engine::id(),
            task: plan.task.id.clone(),
            label: plan.task.label.clone(),
            created: engine::now(),
            status: "pending".into(),
            undo_of: plan.undo_of.clone(),
            done: 0,
            total: ops.len(),
            skipped: plan.comparison.changes.len() - ops.len(),
            message: None,
            undo_available: false,
        };
        let mut work = Work {
            digest: String::new(),
            owner: self.device.id.clone(),
            batch,
            ops,
            common: plan.common.clone(),
            authorization: Some(WorkAuthorization {
                version: SCHEMA_VERSION,
                policy_digest: plan.policy.digest.clone(),
                baseline_digest: digest(&expected)?,
                origin: if plan.undo_of.is_some() {
                    ExecutionOrigin::Undo
                } else {
                    ExecutionOrigin::Manual
                },
                resolutions: plan.resolutions.clone(),
                facts: plan.facts.clone(),
                planned: plan
                    .comparison
                    .changes
                    .iter()
                    .filter(|c| c.action != Action::Conflict)
                    .cloned()
                    .collect(),
            }),
        };
        work.digest = self.engine.work_digest(&work)?;
        Ok((plan, expected, work))
    }
    async fn preflight_pair(
        self: &Arc<Self>,
        work: &Work,
        remote: &mut Session,
    ) -> Result<Vec<RiskAssessment>> {
        // Independent read-only validation can run on both endpoints at once.
        // Each endpoint still performs its authoritative Begin and write-time checks.
        let (local, other) = tokio::try_join!(
            self.local(Rpc::Preflight(work.clone())),
            remote.call(Rpc::Preflight(mirror(work)))
        )?;
        Ok(vec![local, other])
    }
    pub async fn preview_execution(
        self: &Arc<Self>,
        plan_id: &str,
        expected_digest: &str,
        selected: Vec<String>,
    ) -> Result<ExecutionPreview> {
        let _coordinator = self.coordinator.try_lock().context("请先结束当前操作")?;
        let (plan, _, work) = self.prepare_work(plan_id, expected_digest, selected)?;
        let mut remote = self.session(&self.peer(&plan.task.peer)?).await?;
        let risks = self.preflight_pair(&work, &mut remote).await?;
        let paths = work
            .ops
            .iter()
            .map(|op| op.change.path.as_str())
            .collect::<BTreeSet<_>>();
        Ok(ExecutionPreview {
            plan: plan.id,
            digest: plan.digest.clone(),
            selection_digest: digest(&(&plan.digest, &paths))?,
            selected: paths.into_iter().map(str::to_owned).collect(),
            approval_required: risks.iter().any(|risk| !risk.reasons.is_empty()),
            risks,
        })
    }
    pub async fn execute(
        self: &Arc<Self>,
        plan_id: &str,
        expected_digest: &str,
        selected: Vec<String>,
    ) -> Result<Batch> {
        self.execute_reviewed(plan_id, expected_digest, selected, false)
            .await
    }
    pub async fn execute_reviewed(
        self: &Arc<Self>,
        plan_id: &str,
        expected_digest: &str,
        selected: Vec<String>,
        approve_risk: bool,
    ) -> Result<Batch> {
        let _coordinator = self
            .coordinator
            .try_lock()
            .context("设备正在执行其他操作")?;
        let (plan, expected, work) = self.prepare_work(plan_id, expected_digest, selected)?;
        let mut session = self.session(&self.peer(&plan.task.peer)?).await?;
        let risks = self.preflight_pair(&work, &mut session).await?;
        if risks.iter().any(|risk| !risk.reasons.is_empty()) {
            ensure!(
                approve_risk,
                "此次删除触发保护，请由管理端预览并批准准确清单"
            );
            self.local_unit(Rpc::ApproveRisk(work.clone())).await?;
            session.call::<()>(Rpc::ApproveRisk(mirror(&work))).await?;
        }
        let remote_work = mirror(&work);
        let ticket = Ticket::from(&work);
        let phase = Phase::new(&self.phase, "正在保存同步前备份");
        self.start_progress(&work);
        let _progress_guard = progress::ProgressGuard(&self.execution, &ticket.id);
        let node = self.clone();
        let local_work = work.clone();
        let local_expected = expected.clone();
        let approval = plan.id.clone();
        tokio::task::spawn_blocking(move || {
            let _gate = lock(&node.engine.gate);
            node.engine.begin(&local_work, &local_expected)
        })
        .await??;
        lock(&self.plans).remove(&approval);
        let execution = async {
            session
                .call::<()>(Rpc::Begin {
                    work: remote_work,
                    expected,
                })
                .await?;
            phase.set("正在传输和校验已批准文件");
            self.progress_stage(&ticket.id, "transfer");
            if work.batch.undo_of.is_none() {
                for op in &work.ops {
                    let Some(Entry::File { bytes, .. }) = op.change.after else {
                        continue;
                    };
                    let mut offset = 0;
                    self.transfer_progress(&ticket.id, &op.change.path, 0, bytes);
                    while offset < bytes {
                        ensure!(!self.engine.cancelled.load(Ordering::Acquire), "已取消");
                        if op.change.target == 0 {
                            let data: String = session
                                .call(Rpc::Read {
                                    ticket: ticket.clone(),
                                    op: op.id.clone(),
                                    offset,
                                })
                                .await?;
                            let data = STANDARD.decode(data)?;
                            ensure!(!data.is_empty(), "传输意外结束");
                            self.local_unit(Rpc::Chunk {
                                ticket: ticket.clone(),
                                op: op.id.clone(),
                                offset,
                                data: STANDARD.encode(&data),
                            })
                            .await?;
                            offset += data.len() as u64;
                        } else {
                            let data: String = self
                                .local(Rpc::Read {
                                    ticket: ticket.clone(),
                                    op: op.id.clone(),
                                    offset,
                                })
                                .await?;
                            let length = STANDARD.decode(&data)?.len();
                            ensure!(length != 0, "传输意外结束");
                            session
                                .call::<()>(Rpc::Chunk {
                                    ticket: ticket.clone(),
                                    op: op.id.clone(),
                                    offset,
                                    data,
                                })
                                .await?;
                            offset += length as u64;
                        }
                        self.transfer_progress(&ticket.id, &op.change.path, offset, bytes);
                    }
                    self.record_progress(&ticket.id, &op.change.path, "transferred");
                }
            }
            self.progress_stage(&ticket.id, "verify");
            self.local_unit(Rpc::Seal(ticket.clone()))
                .await
                .context("本机准备文件失败")?;
            session
                .call::<()>(Rpc::Seal(ticket.clone()))
                .await
                .context("对端准备文件失败")?;
            ensure!(!self.engine.cancelled.load(Ordering::Acquire), "已取消");
            phase.set("正在应用并核验变更");
            self.progress_stage(&ticket.id, "apply");
            let local: Option<String> = self.local(Rpc::Apply(ticket.clone())).await?;
            if local.is_some() {
                return Ok(local);
            }
            self.remote_apply(&mut session, &ticket, &self.peer(&plan.task.peer)?)
                .await
        }
        .await;
        phase.set("正在核对两端结果");
        self.progress_stage(&ticket.id, "reconcile");
        let message = match execution {
            Ok(message) => message,
            Err(e) => Some(format!("{e:#}")),
        };
        match self.finish_pair(&work, message.clone()).await {
            Ok(batch) => {
                let applied: BTreeSet<_> = self.engine.applied(&batch.id)?.into_iter().collect();
                for op in &work.ops {
                    if applied.contains(&op.id) {
                        self.record_progress(&ticket.id, &op.change.path, "applied");
                    }
                }
                if let Some(log) = lock(&self.execution)
                    .as_mut()
                    .filter(|l| l.summary.batch == ticket.id)
                {
                    log.summary.running = false;
                    log.summary.stage = batch.status.clone();
                    log.summary.current_path.clear();
                }
                if batch.status == "completed" && batch.skipped == 0 && batch.undo_of.is_none() {
                    lock(&self.review_pending).remove(&batch.task);
                }
                Ok(batch)
            }
            Err(error) => {
                if let Some(log) = lock(&self.execution)
                    .as_mut()
                    .filter(|l| l.summary.batch == ticket.id)
                {
                    log.summary.running = false;
                    log.summary.stage = "pending".into();
                }
                let mut batch = work.batch;
                batch.message = Some(match message {
                    Some(message) => format!("{message}。等待两端核对：{error:#}"),
                    None => format!("等待两端核对：{error:#}"),
                });
                self.engine
                    .store
                    .put("pending_note", &batch.id, &batch.message)?;
                Ok(batch)
            }
        }
    }

    pub async fn reconcile(self: &Arc<Self>, id: &str) -> Result<Batch> {
        let _coordinator = self.coordinator.try_lock().context("请先结束当前操作")?;
        ensure!(
            !lock(&self.incoming)
                .as_ref()
                .is_some_and(|(batch, _)| batch == id),
            "对端正在执行此批次，请稍后核对"
        );
        let work = self.engine.work(id)?;
        let _phase = Phase::new(&self.phase, "正在核对批次记录");
        self.finish_pair(&work, Some("已核对中断批次".into())).await
    }

    async fn finish_pair(self: &Arc<Self>, work: &Work, message: Option<String>) -> Result<Batch> {
        let ticket = Ticket::from(work);
        let task = self.engine.task(&work.batch.task)?;
        let local: Option<Outcome> = self.local(Rpc::Outcome(ticket.clone())).await?;
        let local = local.context("本机缺少批次记录")?;
        let mut remote = self.session(&self.peer(&task.peer)?).await?;
        let other: Option<Outcome> = remote.call(Rpc::Outcome(ticket.clone())).await?;
        let mut steps = local.steps;
        if let Some(other) = &other {
            steps.extend(other.steps.iter().cloned());
        }
        let mut applied: Vec<_> = steps
            .iter()
            .filter(|(_, s)| *s == Step::Applied)
            .map(|(id, _)| id.clone())
            .collect();
        applied.sort();
        applied.dedup();
        ensure!(
            !steps.iter().any(|(_, s)| *s == Step::Review),
            "发现需要人工核对的变更，原文件保留在同步目录的 .syncfu-stage"
        );
        let (status, message) = if let Some(finished) = local
            .batch
            .as_ref()
            .or_else(|| other.as_ref().and_then(|o| o.batch.as_ref()))
        {
            applied = if local.batch.is_some() {
                local.applied
            } else {
                other
                    .as_ref()
                    .map(|o| o.applied.clone())
                    .unwrap_or_default()
            };
            (finished.status.clone(), finished.message.clone())
        } else if applied.len() == work.ops.len() {
            ("completed".into(), message)
        } else if !applied.is_empty() {
            ("partial".into(), message)
        } else if self.engine.cancelled.load(Ordering::Acquire) {
            ("cancelled".into(), message)
        } else {
            (
                "failed".into(),
                message.or_else(|| Some("未应用任何操作".into())),
            )
        };
        if other.is_some() {
            remote
                .call::<Batch>(Rpc::Finish {
                    ticket: ticket.clone(),
                    applied: applied.clone(),
                    status: status.clone(),
                    message: message.clone(),
                })
                .await?;
        }
        self.local(Rpc::Finish {
            ticket,
            applied,
            status,
            message,
        })
        .await
    }

    pub async fn cancel(&self) -> Result<()> {
        let Some(work) = self.engine.active()? else {
            return Ok(());
        };
        self.engine.stop_work(&work)?;
        let task = self.engine.task(&work.batch.task)?;
        if let Ok(mut session) = self.session(&self.peer(&task.peer)?).await {
            let _ = session
                .call::<()>(Rpc::Cancel(Ticket::from(work.as_ref())))
                .await;
        }
        Ok(())
    }

    async fn local_unit(self: &Arc<Self>, rpc: Rpc) -> Result<()> {
        self.local(rpc).await
    }
    async fn local<T: DeserializeOwned>(self: &Arc<Self>, rpc: Rpc) -> Result<T> {
        let node = self.clone();
        let value = tokio::task::spawn_blocking(move || node.rpc("", rpc)).await??;
        Ok(serde_json::from_value(value)?)
    }

    fn rpc(&self, peer: &str, rpc: Rpc) -> Result<serde_json::Value> {
        fn json(value: impl Serialize) -> Result<serde_json::Value> {
            Ok(serde_json::to_value(value)?)
        }
        match rpc {
            Rpc::Policy(task) => {
                self.validate_peer(peer, &task)?;
                return json(self.engine.policy_state(&task)?);
            }
            Rpc::OfferPolicy(proposal) => {
                self.validate_peer(peer, &proposal.next.task)?;
                let actor = if peer.is_empty() {
                    self.device.id.as_str()
                } else {
                    peer
                };
                return json(self.engine.offer_policy(&proposal, actor)?);
            }
            Rpc::CommitPolicy {
                task,
                proposal,
                digest,
            } => {
                self.validate_peer(peer, &task)?;
                return json(self.engine.commit_policy(&task, &proposal, &digest)?);
            }
            Rpc::ConfirmPolicy {
                task,
                proposal,
                digest,
            } => {
                self.validate_peer(peer, &task)?;
                return json(self.engine.confirm_policy(&task, &proposal, &digest)?);
            }
            Rpc::RejectPolicy { task, receipt } => {
                self.validate_peer(peer, &task)?;
                return json(self.engine.acknowledge_rejection(&task, &receipt)?);
            }
            Rpc::Preflight(work) => {
                self.validate_peer(peer, &work.batch.task)?;
                let actor = if peer.is_empty() {
                    self.device.id.as_str()
                } else {
                    peer
                };
                ensure!(work.owner == actor, "执行发起身份不符");
                let _gate = lock(&self.engine.gate);
                return json(self.engine.preflight(&work)?);
            }
            Rpc::ApproveRisk(work) => {
                self.validate_peer(peer, &work.batch.task)?;
                let actor = if peer.is_empty() {
                    self.device.id.as_str()
                } else {
                    peer
                };
                ensure!(work.owner == actor, "风险批准发起身份不符");
                self.engine.approve_work_risk(&work, actor)?;
                return json(());
            }
            Rpc::Link(mut task) => {
                ensure!(
                    !peer.is_empty()
                        && task.peer == peer
                        && task.id == pair_key(&task.local, &task.remote)?,
                    "目录关联无效"
                );
                let folder = self
                    .engine
                    .grants(peer)?
                    .into_iter()
                    .find(|f| f.id == task.local)
                    .context("目录未授权")?;
                task.label = folder.label;
                task.local_path = folder.path;
                self.engine.link_task(&task)?;
                return json(());
            }
            Rpc::Ping => {
                let dirty = lock(&self.dirty);
                let ids = self
                    .engine
                    .grants(peer)?
                    .into_iter()
                    .filter(|g| dirty.contains_key(&g.id))
                    .map(|g| g.id)
                    .collect::<BTreeSet<_>>();
                return json(ids);
            }
            Rpc::Folders => return json(self.engine.grants(peer)?),
            Rpc::PreviewFile(request) => {
                self.validate_peer(peer, &request.task)?;
                return json(self.engine.read_preview(&request, peer)?);
            }
            Rpc::Scan(grant) => return json(self.scan_grant(&grant, peer, None)?),
            Rpc::ScanStatus(grant) => {
                ensure!(
                    self.engine
                        .grants(peer)?
                        .iter()
                        .any(|folder| folder.id == grant),
                    "目录未授权"
                );
                return json(
                    lock(&self.scan_report)
                        .as_ref()
                        .filter(|report| report.grant == grant)
                        .cloned(),
                );
            }
            Rpc::Progress { ticket, after } => {
                let log = lock(&self.execution);
                let log = log.as_ref().context("找不到批次进度")?;
                ensure!(
                    log.summary.batch == ticket.id && log.digest == ticket.digest,
                    "批次标识或摘要不一致"
                );
                self.validate_peer(peer, &log.summary.task)?;
                let page = log.page(Some(&ticket.id), after);
                return json(page);
            }
            Rpc::Cancel(ticket) => {
                if let Some(work) = self.engine.active()?
                    && work.batch.id == ticket.id
                    && work.digest == ticket.digest
                {
                    self.validate_peer(peer, &work.batch.task)?;
                    self.engine.stop_work(&work)?;
                }
                return json(());
            }
            Rpc::Observe {
                task,
                expected,
                common,
            } => {
                self.validate_peer(peer, &task)?;
                self.observe(&task, &expected, &common)?;
                return json(());
            }
            _ => (),
        }
        let _gate = lock(&self.engine.gate);
        match rpc {
            Rpc::State(task) => {
                self.validate_peer(peer, &task)?;
                json(self.engine.pair_state(&task)?)
            }
            Rpc::Begin { work, expected } => {
                self.validate_peer(peer, &work.batch.task)?;
                ensure!(work.owner == peer, "批次发起设备无效");
                if let Some(active) = self.engine.active()? {
                    // A competing reservation must be fully authorized before it
                    // can cancel the current one. With no active work, begin()
                    // performs this same validation once, not twice in succession.
                    let risk = self.engine.preflight(&work)?;
                    if active.batch.id == work.batch.id && active.digest == work.digest {
                        self.engine.verify_frozen_work(&work)?;
                        return json(());
                    }
                    self.engine.require_risk_permit(&work, &risk)?;
                    let simultaneous = active.batch.task == work.batch.task
                        && active.owner == self.device.id
                        && peer < self.device.id.as_str()
                        && !self
                            .engine
                            .store
                            .get::<bool>("sealed", &active.batch.id)?
                            .unwrap_or(false);
                    ensure!(simultaneous, "另一批次正在进行");
                    // The lower device ID wins a same-pair reservation collision before either batch writes.
                    self.engine.finish(
                        &active,
                        &[],
                        "cancelled",
                        Some("另一台设备已先获得执行权".into()),
                    )?;
                }
                self.engine.begin(&work, &expected)?;
                self.start_progress(&work);
                json(())
            }
            Rpc::Read { ticket, op, offset } => {
                let work = self.get_work(peer, &ticket, true)?.context("批次未执行")?;
                let op = find_op(&work, &op)?;
                let data = self.engine.read_chunk(&work, op, offset)?;
                self.progress_stage(&ticket.id, "transfer");
                self.transfer_progress(
                    &ticket.id,
                    &op.change.path,
                    offset + data.len() as u64,
                    op.change.after.as_ref().map_or(0, Entry::bytes),
                );
                json(STANDARD.encode(data))
            }
            Rpc::Chunk {
                ticket,
                op,
                offset,
                data,
            } => {
                let work = self.get_work(peer, &ticket, true)?.context("批次未执行")?;
                ensure!(
                    data.len() <= engine::TRANSFER_ENCODED_LIMIT,
                    "文件片段超出限制"
                );
                let op = find_op(&work, &op)?;
                let data = STANDARD.decode(data)?;
                self.engine.chunk(&work, op, offset, &data)?;
                self.progress_stage(&ticket.id, "transfer");
                self.transfer_progress(
                    &ticket.id,
                    &op.change.path,
                    offset + data.len() as u64,
                    op.change.after.as_ref().map_or(0, Entry::bytes),
                );
                json(())
            }
            Rpc::Seal(ticket) => {
                let work = self.get_work(peer, &ticket, true)?.context("批次未执行")?;
                self.progress_stage(&ticket.id, "verify");
                self.engine.seal(&work)?;
                self.engine.store.put("sealed", &work.batch.id, &true)?;
                json(())
            }
            Rpc::Apply(ticket) => {
                let work = self.get_work(peer, &ticket, true)?.context("批次未执行")?;
                ensure!(
                    self.engine
                        .store
                        .get::<bool>("sealed", &work.batch.id)?
                        .unwrap_or(false),
                    "批次尚未准备完成"
                );
                self.progress_stage(&ticket.id, "apply");
                json(self.engine.apply_with_progress(&work, |op, step| {
                    self.record_progress(
                        &ticket.id,
                        &op.change.path,
                        if step == Step::Applied {
                            "applied"
                        } else {
                            "failed"
                        },
                    );
                })?)
            }
            Rpc::Outcome(ticket) => {
                let Some(work) = self.get_work(peer, &ticket, false)? else {
                    return json(None::<Outcome>);
                };
                let batch: Option<Batch> = self.engine.store.get("history", &ticket.id)?;
                let steps = if batch.is_some() {
                    vec![]
                } else {
                    self.engine.outcome(&work)?
                };
                json(Some(Outcome {
                    steps,
                    batch,
                    applied: self.engine.applied(&ticket.id)?,
                }))
            }
            Rpc::Finish {
                ticket,
                applied,
                status,
                message,
            } => {
                let work = self.get_work(peer, &ticket, false)?.context("找不到批次")?;
                if let Some(batch) = self.engine.store.get::<Batch>("history", &ticket.id)? {
                    return json(batch);
                }
                ensure!(
                    matches!(
                        status.as_str(),
                        "completed" | "partial" | "failed" | "cancelled"
                    ),
                    "批次状态无效"
                );
                let outcome = self.engine.outcome(&work)?;
                let applied_ids: BTreeSet<_> = applied.iter().collect();
                let operation_ids: BTreeSet<_> = work.ops.iter().map(|op| &op.id).collect();
                ensure!(
                    !outcome.iter().any(|(_, s)| *s == Step::Review)
                        && outcome
                            .iter()
                            .all(|(id, step)| (*step == Step::Applied) == applied_ids.contains(id))
                        && applied_ids.is_subset(&operation_ids),
                    "操作结果需要核对"
                );
                let batch = self.engine.finish(&work, &applied, &status, message)?;
                for op in &work.ops {
                    if applied_ids.contains(&op.id) {
                        self.record_progress(&ticket.id, &op.change.path, "applied");
                    }
                }
                if let Some(log) = lock(&self.execution)
                    .as_mut()
                    .filter(|l| l.summary.batch == ticket.id)
                {
                    log.summary.running = false;
                    log.summary.stage = status;
                }
                json(batch)
            }
            _ => bail!("未知操作"),
        }
    }

    fn validate_peer(&self, peer: &str, task: &str) -> Result<()> {
        let task = self.engine.task(task)?;
        if !peer.is_empty() {
            ensure!(task.peer == peer, "任务未授权");
            self.peer(peer)?;
        }
        Ok(())
    }

    fn get_work(&self, peer: &str, ticket: &Ticket, active: bool) -> Result<Option<Arc<Work>>> {
        let work = if active {
            self.engine.active()?
        } else {
            self.engine
                .store
                .get::<Work>("work", &ticket.id)?
                .map(Arc::new)
        };
        if let Some(work) = &work {
            ensure!(
                work.batch.id == ticket.id && work.digest == ticket.digest,
                "批次标识或摘要不一致"
            );
            self.validate_peer(peer, &work.batch.task)?;
        }
        Ok(work)
    }
}

impl Drop for Node {
    fn drop(&mut self) {
        if let Some(daemon) = lock(&self.daemon).take() {
            let _ = daemon.shutdown();
        }
    }
}

struct Incoming<'a> {
    slot: &'a Mutex<Option<(String, String)>>,
    execution: &'a Mutex<Option<ExecutionLog>>,
    connection: String,
}
impl<'a> Incoming<'a> {
    fn new(
        slot: &'a Mutex<Option<(String, String)>>,
        execution: &'a Mutex<Option<ExecutionLog>>,
    ) -> Self {
        Self {
            slot,
            execution,
            connection: engine::id(),
        }
    }
    fn begin(&self, batch: String) {
        *lock(self.slot) = Some((batch, self.connection.clone()));
    }
    fn finish(&self, batch: &str) {
        let mut slot = lock(self.slot);
        if slot.as_ref().is_some_and(|(id, _)| id == batch) {
            *slot = None;
        }
    }
}
impl Drop for Incoming<'_> {
    fn drop(&mut self) {
        let mut slot = lock(self.slot);
        if slot
            .as_ref()
            .is_some_and(|(_, connection)| connection == &self.connection)
        {
            let batch = slot.take().map(|(batch, _)| batch);
            drop(slot);
            if let Some(log) = lock(self.execution).as_mut()
                && batch.as_deref() == Some(log.summary.batch.as_str())
                && log.summary.running
            {
                log.summary.running = false;
                log.summary.stage = "interrupted".into();
            }
        }
    }
}

struct ScanActivityGuard<'a>(&'a Mutex<Option<ScanActivity>>);
impl<'a> ScanActivityGuard<'a> {
    fn new(target: &'a Mutex<Option<ScanActivity>>, task: &str) -> Self {
        *lock(target) = Some(ScanActivity {
            task: task.into(),
            local: None,
            remote: None,
            incoming: false,
        });
        Self(target)
    }
}
impl Drop for ScanActivityGuard<'_> {
    fn drop(&mut self) {
        *lock(self.0) = None;
    }
}

struct Phase<'a>(&'a Mutex<Option<String>>);
impl<'a> Phase<'a> {
    fn new(target: &'a Mutex<Option<String>>, value: &str) -> Self {
        let phase = Self(target);
        phase.set(value);
        phase
    }
    fn set(&self, value: &str) {
        *lock(self.0) = Some(value.into());
    }
}
impl Drop for Phase<'_> {
    fn drop(&mut self) {
        *lock(self.0) = None;
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod progress_tests;
#[cfg(test)]
mod scan_tests;
fn find_op<'a>(work: &'a Work, id: &str) -> Result<&'a Operation> {
    work.ops
        .binary_search_by(|op| op.id.as_str().cmp(id))
        .ok()
        .map(|idx| &work.ops[idx])
        .context("未批准此操作")
}
fn fingerprint(cert: &[u8]) -> String {
    hex::encode(Sha256::digest(cert))
}
fn mirror(work: &Work) -> Work {
    let mut work = work.clone();
    for op in &mut work.ops {
        op.change.target = 1 - op.change.target;
    }
    if let Some(auth) = &mut work.authorization {
        for change in &mut auth.planned {
            change.target = 1 - change.target;
        }
    }
    work
}
fn child_of(path: &str, parent: &str) -> bool {
    path.strip_prefix(parent)
        .is_some_and(|p| p.starts_with('/'))
}
fn pair_key(a: &str, b: &str) -> Result<String> {
    engine::valid_id(a)?;
    engine::valid_id(b)?;
    ensure!(a != b, "两端目录标识相同");
    digest(&if a < b { [a, b] } else { [b, a] })
}
fn parse_address(address: &str) -> Result<SocketAddr> {
    let address = address.trim();
    if let Ok(addr) = address.parse::<SocketAddr>() {
        return Ok(addr);
    }
    Ok(SocketAddr::new(
        address.parse().context("请输入局域网 IP 或 IP:端口")?,
        DEFAULT_PORT,
    ))
}
fn local_address(address: IpAddr) -> bool {
    if address.is_loopback() {
        return true;
    }
    let IpAddr::V4(address) = address else {
        return false;
    };
    if !address.is_private() && !address.is_link_local() {
        return false;
    }
    if_addrs::get_if_addrs().is_ok_and(|items| {
        items.iter().any(|item| {
            if let if_addrs::IfAddr::V4(interface) = &item.addr {
                u32::from(interface.ip) & u32::from(interface.netmask)
                    == u32::from(address) & u32::from(interface.netmask)
                    && !interface.ip.is_loopback()
            } else {
                false
            }
        })
    })
}

// Preserve the existing explicit PAKE/channel-binding inputs and their order.
#[allow(clippy::too_many_arguments)]
fn bound_context(
    exporter: &[u8; 32],
    server: &[u8],
    client: &[u8],
    session: &str,
    server_leaf: &[u8],
    client_leaf: &[u8],
    name: &str,
    port: u16,
) -> Vec<u8> {
    let mut context = pairing::pairing_context(exporter, server, client, session);
    context.extend(Sha256::digest(server_leaf));
    context.extend(Sha256::digest(client_leaf));
    context.extend(Sha256::digest(name.as_bytes()));
    context.extend(port.to_be_bytes());
    context
}

mod framing;

async fn send(stream: &mut (impl AsyncWrite + Unpin), value: &impl Serialize) -> Result<()> {
    framing::send(stream, PROTOCOL, value).await
}
async fn receive<T: DeserializeOwned>(stream: &mut (impl AsyncRead + Unpin)) -> Result<T> {
    framing::receive(stream, PROTOCOL, None).await
}
async fn receive_small<T: DeserializeOwned>(stream: &mut (impl AsyncRead + Unpin)) -> Result<T> {
    framing::receive(stream, PROTOCOL, Some(32 * 1024)).await
}

#[cfg(test)]
mod p1_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn discovered_address_fallback_checks_identity_and_local_grants_work_offline()
    -> Result<()> {
        let temp = tempfile::tempdir()?;
        let addr = "127.0.0.1:0".parse()?;
        let local = Node::start(
            Engine::open(&temp.path().join("local"))?,
            Identity::generate()?,
            "Local".into(),
            addr,
            false,
        )
        .await?;
        let remote = Node::start(
            Engine::open(&temp.path().join("remote"))?,
            Identity::generate()?,
            "Remote".into(),
            addr,
            false,
        )
        .await?;
        let wrong = SocketAddr::new(addr.ip(), local.device.port);
        let right = SocketAddr::new(addr.ip(), remote.device.port);
        let id = remote.device.id.clone();
        local.check_listener().await?;
        assert_eq!(local.probe_peer(&right.to_string()).await?, "Remote");
        assert!(local.probe_peer(&wrong.to_string()).await.is_err());
        remote.invite()?;
        lock(&local.nearby).insert(
            id.clone(),
            Nearby {
                name: remote.device.name.clone(),
                addresses: vec![wrong, right],
            },
        );
        assert_eq!(
            local.open_candidates([wrong], Some(&id), None).await?.0,
            right
        );

        lock(&local.nearby).remove(&id);
        let peer = Peer {
            id: id.clone(),
            name: remote.device.name.clone(),
            address: wrong.to_string(),
            cert: remote.identity.cert_der().to_vec(),
            leaf: remote.identity.leaf_der().to_vec(),
        };
        let root = temp.path().join("files");
        std::fs::create_dir(&root)?;
        assert!(local.local_folders(&id).is_err());
        local.engine.store.put("peers", &id, &peer)?;
        let grant = local.grant(&id, &root)?;
        assert!(local.folders(&id).await.is_err());
        assert_eq!(local.local_folders(&id)?[0].id, grant.id);
        Ok(())
    }
}
