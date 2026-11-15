use super::*;

/// Compact live totals. File outcomes are read separately in bounded pages.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionProgress {
    pub batch: String,
    pub task: String,
    pub total: usize,
    pub done: usize,
    pub transferred_bytes: u64,
    pub total_bytes: u64,
    pub current_path: String,
    pub current_bytes: u64,
    pub current_total: u64,
    pub stage: String,
    pub running: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileProgress {
    pub path: String,
    pub state: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressPage {
    pub summary: Option<ExecutionProgress>,
    pub events: Vec<FileProgress>,
    pub cursor: usize,
    pub more: bool,
}
pub(super) struct ExecutionLog {
    pub summary: ExecutionProgress,
    pub digest: String,
    events: Vec<FileProgress>,
    states: BTreeMap<String, String>,
    transferred: BTreeMap<String, u64>,
}
impl ExecutionLog {
    pub fn new(work: &Work) -> Self {
        Self {
            digest: work.digest.clone(),
            summary: ExecutionProgress {
                batch: work.batch.id.clone(),
                task: work.batch.task.clone(),
                total: work.ops.len(),
                done: 0,
                transferred_bytes: 0,
                total_bytes: work.ops.iter().fold(0u64, |sum, op| {
                    sum.saturating_add(match op.change.after {
                        Some(Entry::File { bytes, .. }) if work.batch.undo_of.is_none() => bytes,
                        _ => 0,
                    })
                }),
                current_path: String::new(),
                current_bytes: 0,
                current_total: 0,
                stage: "backup".into(),
                running: true,
            },
            events: work
                .ops
                .iter()
                .map(|op| FileProgress {
                    path: op.change.path.clone(),
                    state: "waiting".into(),
                })
                .collect(),
            states: work
                .ops
                .iter()
                .map(|op| (op.change.path.clone(), "waiting".into()))
                .collect(),
            transferred: BTreeMap::new(),
        }
    }
    fn transfer(&mut self, path: &str, offset: u64, total: u64) {
        let previous = self.transferred.entry(path.into()).or_default();
        let next = (*previous).max(offset.min(total));
        self.summary.transferred_bytes = self
            .summary
            .transferred_bytes
            .saturating_add(next - *previous);
        *previous = next;
        self.summary.current_path = path.into();
        self.summary.current_bytes = next;
        self.summary.current_total = total;
        if next == total {
            self.record(path, "transferred");
        }
    }
    pub fn record(&mut self, path: &str, state: &str) {
        let previous = self.states.get(path).map(String::as_str);
        // An observed, persisted application cannot regress on a late poll.
        if previous == Some(state)
            || previous == Some("applied")
            || previous == Some("transferred") && state == "waiting"
            || previous == Some("failed") && state != "applied"
        {
            return;
        }
        if state == "applied" {
            self.summary.done += 1;
        }
        self.states.insert(path.into(), state.into());
        self.events.push(FileProgress {
            path: path.into(),
            state: state.into(),
        });
    }
    pub fn page(&self, batch: Option<&str>, after: usize) -> ProgressPage {
        let start = if batch == Some(self.summary.batch.as_str()) {
            after.min(self.events.len())
        } else {
            0
        };
        let end = start.saturating_add(256).min(self.events.len());
        ProgressPage {
            summary: Some(self.summary.clone()),
            events: self.events[start..end].to_vec(),
            cursor: end,
            more: end < self.events.len(),
        }
    }
}
pub(super) struct ProgressGuard<'a>(pub &'a Mutex<Option<ExecutionLog>>, pub &'a str);
impl Drop for ProgressGuard<'_> {
    fn drop(&mut self) {
        if let Some(log) = lock(self.0).as_mut()
            && log.summary.batch == self.1
            && log.summary.running
        {
            log.summary.running = false;
            log.summary.stage = "interrupted".into();
        }
    }
}
impl Node {
    pub fn execution_progress(&self, batch: Option<&str>, after: usize) -> ProgressPage {
        lock(&self.execution).as_ref().map_or(
            ProgressPage {
                summary: None,
                events: vec![],
                cursor: 0,
                more: false,
            },
            |log| log.page(batch, after),
        )
    }
    pub(super) fn start_progress(&self, work: &Work) {
        *lock(&self.execution) = Some(ExecutionLog::new(work));
    }
    pub(super) fn progress_stage(&self, batch: &str, stage: &str) {
        if let Some(log) = lock(&self.execution)
            .as_mut()
            .filter(|l| l.summary.batch == batch)
        {
            log.summary.stage = stage.into();
        }
    }
    pub(super) fn record_progress(&self, batch: &str, path: &str, state: &str) {
        if let Some(log) = lock(&self.execution)
            .as_mut()
            .filter(|l| l.summary.batch == batch)
        {
            log.record(path, state);
        }
    }
    pub(super) fn transfer_progress(&self, batch: &str, path: &str, offset: u64, total: u64) {
        if let Some(log) = lock(&self.execution)
            .as_mut()
            .filter(|l| l.summary.batch == batch)
        {
            log.transfer(path, offset, total);
        }
    }
    pub(super) async fn remote_apply(
        self: &Arc<Self>,
        session: &mut Session,
        ticket: &Ticket,
        peer: &Peer,
    ) -> Result<Option<String>> {
        // Progress is optional: failure to open this extra connection must not
        // prevent the existing, authenticated Apply connection from doing work.
        let mut status = timeout(Duration::from_secs(3), self.session(peer))
            .await
            .ok()
            .and_then(Result::ok);
        let mut cursor = 0;
        let mut supported = true;
        if let Some(connection) = status.as_mut() {
            // Apply has not been dispatched yet. Skip the already-known waiting
            // and transfer prefix so a large batch shows applied files promptly.
            match timeout(
                Duration::from_secs(3),
                connection.call::<ProgressPage>(Rpc::Progress {
                    ticket: ticket.clone(),
                    after: usize::MAX,
                }),
            )
            .await
            {
                Ok(Ok(page)) => cursor = page.cursor,
                Ok(Err(_)) => {
                    status = None;
                    supported = false;
                }
                Err(_) => status = None,
            }
        }
        let request = session.call::<Option<String>>(Rpc::Apply(ticket.clone()));
        if !supported {
            return request.await;
        }
        tokio::pin!(request);
        let mut tick = tokio::time::interval(Duration::from_millis(250));
        loop {
            tokio::select! {
                result = &mut request => return result,
                _ = tick.tick() => {
                    // This endpoint reads only the progress mutex, never the apply gate.
                    let Some(connection) = status.as_mut() else {
                        // A timed-out framed stream cannot be reused: its next
                        // reply may belong to the abandoned request.
                        status = timeout(Duration::from_secs(3), self.session(peer)).await.ok().and_then(Result::ok);
                        continue;
                    };
                    match timeout(Duration::from_secs(3), connection.call::<ProgressPage>(Rpc::Progress { ticket: ticket.clone(), after: cursor })).await {
                        Ok(Ok(page)) => {
                            cursor = page.cursor;
                            for event in page.events { self.record_progress(&ticket.id, &event.path, &event.state); }
                            if page.more { tick.reset_immediately(); }
                        }
                        Ok(Err(_)) => {
                            // Older peers may not understand this optional RPC.
                            // Complete the original request without polling.
                            return request.await;
                        }
                        Err(_) => status = None,
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn empty_log() -> ExecutionLog {
        ExecutionLog {
            digest: "digest".into(),
            summary: ExecutionProgress {
                batch: "current".into(),
                task: "task".into(),
                total: 2,
                done: 0,
                transferred_bytes: 0,
                total_bytes: 16,
                current_path: String::new(),
                current_bytes: 0,
                current_total: 0,
                stage: "transfer".into(),
                running: true,
            },
            events: vec![],
            states: BTreeMap::new(),
            transferred: BTreeMap::new(),
        }
    }

    #[test]
    fn repeated_or_out_of_order_transfer_updates_count_each_byte_once() {
        let mut log = empty_log();
        log.transfer("one.txt", 5, 10);
        log.transfer("one.txt", 5, 10);
        log.transfer("one.txt", 3, 10);
        assert_eq!(log.summary.transferred_bytes, 5);
        assert_eq!(log.summary.current_bytes, 5);
        log.transfer("two.txt", 6, 6);
        log.transfer("one.txt", 10, 10);
        log.transfer("one.txt", 8, 10);
        assert_eq!(log.summary.transferred_bytes, 16);
        assert_eq!(log.summary.current_bytes, 10);
        assert_eq!(log.summary.done, 0, "transferred is not applied");
        assert_eq!(log.events.len(), 2);
    }

    #[test]
    fn an_old_progress_guard_cannot_interrupt_a_replacement_batch() {
        let execution = Mutex::new(Some(empty_log()));
        drop(ProgressGuard(&execution, "old"));
        assert!(lock(&execution).as_ref().unwrap().summary.running);
        drop(ProgressGuard(&execution, "current"));
        let log = lock(&execution);
        assert!(!log.as_ref().unwrap().summary.running);
        assert_eq!(log.as_ref().unwrap().summary.stage, "interrupted");
    }

    #[test]
    fn progress_pages_are_bounded_reset_and_never_regress() {
        let mut log = ExecutionLog {
            digest: "digest".into(),
            summary: ExecutionProgress {
                batch: "new".into(),
                task: "task".into(),
                total: 600,
                done: 0,
                transferred_bytes: 0,
                total_bytes: 0,
                current_path: String::new(),
                current_bytes: 0,
                current_total: 0,
                stage: "apply".into(),
                running: true,
            },
            events: vec![],
            states: BTreeMap::new(),
            transferred: BTreeMap::new(),
        };
        for i in 0..600 {
            log.record(&format!("{i}.txt"), "applied");
        }
        log.record("0.txt", "transferred");
        log.record("0.txt", "applied");
        assert_eq!(log.summary.done, 600);
        let first = log.page(Some("old"), 599);
        assert_eq!(first.events.len(), 256);
        assert_eq!(first.cursor, 256);
        assert!(first.more);
        let last = log.page(Some("new"), 512);
        assert_eq!(last.events.len(), 88);
        assert!(!last.more);
    }

    #[test]
    fn delayed_remote_waiting_events_cannot_regress_file_states() {
        let mut log = ExecutionLog {
            digest: "digest".into(),
            summary: ExecutionProgress {
                batch: "batch".into(),
                task: "task".into(),
                total: 1,
                done: 0,
                transferred_bytes: 0,
                total_bytes: 1,
                current_path: String::new(),
                current_bytes: 0,
                current_total: 0,
                stage: "transfer".into(),
                running: true,
            },
            events: vec![],
            states: BTreeMap::new(),
            transferred: BTreeMap::new(),
        };
        for state in [
            "waiting",
            "transferred",
            "waiting",
            "failed",
            "transferred",
            "waiting",
            "applied",
            "failed",
        ] {
            log.record("one.txt", state);
        }
        assert_eq!(
            log.events
                .iter()
                .map(|event| event.state.as_str())
                .collect::<Vec<_>>(),
            vec!["waiting", "transferred", "failed", "applied"]
        );
        assert_eq!(log.summary.done, 1);
    }
}
