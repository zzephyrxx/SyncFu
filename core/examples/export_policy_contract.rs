use anyhow::{Context, Result, ensure};
use std::{collections::BTreeMap, fs, path::Path};
use syncfu_core::{
    conflicts::*,
    model::{Entry, Task, digest},
    policy::*,
    risk::*,
    usage::*,
};
use ts_rs::TS;

fn main() -> Result<()> {
    let check = std::env::args().skip(1).any(|arg| arg == "--check");
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .context("workspace missing")?;
    let declarations = [
        Entry::decl(),
        ConflictDescriptor::decl(),
        ConflictResolution::decl(),
        Decision::decl(),
        DecisionRequest::decl(),
        ReviewNote::decl(),
        FilePreview::decl(),
        ConflictPreview::decl(),
        UsageRecord::decl(),
        UsageReport::decl(),
        Endpoint::decl(),
        Direction::decl(),
        Trigger::decl(),
        Trust::decl(),
        ConflictRule::decl(),
        DeleteRules::decl(),
        TaskPolicy::decl(),
        Proposal::decl(),
        PendingPolicy::decl(),
        ReceiptOutcome::decl(),
        PolicyReceipt::decl(),
        PolicyState::decl(),
        PolicyStamp::decl(),
        PolicyView::decl(),
        RiskReason::decl(),
        RiskAssessment::decl(),
        ExecutionPreview::decl(),
    ];
    let mut types = String::from(
        "// Generated from Rust Serde DTOs. Do not edit.\n// cargo run -p syncfu-core --features bindings --example export_policy_contract\n\n",
    );
    for declaration in declarations {
        types.push_str(&format!("export {declaration}\n"));
    }
    let commands = BTreeMap::from([
        ("resolvePlan", "resolve_plan"),
        ("previewConflict", "preview_conflict"),
        ("reviewNotes", "review_notes"),
        ("clearReviewNote", "clear_review_note"),
        ("usage", "usage_report"),
        ("usageEnabled", "set_usage_enabled"),
        ("clearUsage", "clear_usage"),
        ("taskPolicy", "task_policy"),
        ("propose", "propose_task_policy"),
        ("answer", "answer_task_policy"),
        ("reconcile", "reconcile_task_policy"),
        ("pauseTask", "pause_task"),
        ("pauseAll", "pause_all"),
        ("previewExecution", "preview_execution"),
        ("execute", "execute_plan"),
    ]);
    types.push_str(&format!(
        "\nexport const policyCommands = {} as const;\n",
        serde_json::to_string_pretty(&commands)?
    ));
    types.push_str(&format!(
        "export const wireProtocol = {} as const;\n",
        syncfu_core::node::PROTOCOL
    ));
    let local = "a".repeat(64);
    let peer = "b".repeat(64);
    let grants = [
        uuid::Uuid::from_u128(1).to_string(),
        uuid::Uuid::from_u128(2).to_string(),
    ];
    let task = Task {
        id: digest(&grants)?,
        peer,
        local: grants[0].clone(),
        remote: grants[1].clone(),
        label: "fixture".into(),
        local_path: "sample-local".into(),
        remote_path: "sample-remote".into(),
    };
    let legacy = TaskPolicy::legacy(&task, &local)?;
    let mut personal = legacy.clone();
    personal.revision = 1;
    personal.trust = Trust::Personal;
    personal.validate()?;
    let proposal = Proposal {
        id: uuid::Uuid::from_u128(3).to_string(),
        expected_revision: 0,
        next: personal.clone(),
        proposed_by: local.clone(),
    };
    proposal.validate(&legacy)?;
    let receipt = PolicyReceipt {
        proposal: proposal.id.clone(),
        digest: proposal.fingerprint()?,
        outcome: ReceiptOutcome::Committed,
    };
    let views = vec![
        PolicyView {
            task: task.id.clone(),
            paused: false,
            state: PolicyState {
                current: legacy.clone(),
                pending: None,
                last_receipt: None,
            },
        },
        PolicyView {
            task: task.id.clone(),
            paused: false,
            state: PolicyState {
                current: legacy,
                pending: Some(PendingPolicy {
                    proposal,
                    accepted: false,
                }),
                last_receipt: None,
            },
        },
        PolicyView {
            task: task.id.clone(),
            paused: true,
            state: PolicyState {
                current: personal,
                pending: None,
                last_receipt: Some(receipt),
            },
        },
    ];
    let preview = ExecutionPreview {
        plan: uuid::Uuid::from_u128(4).to_string(),
        digest: "c".repeat(64),
        selection_digest: "d".repeat(64),
        approval_required: true,
        selected: vec!["example.txt".into()],
        risks: vec![RiskAssessment {
            device: local.clone(),
            planned_deletions: 103,
            selected_deletions: 9,
            recent_deletions: 0,
            baseline_files: 104,
            reasons: vec![RiskReason::LargeDeletion, RiskReason::RelativeDeletion],
        }],
    };
    let directions = vec![
        Direction::Bidirectional,
        Direction::OneWayUpdate {
            source_device: local.clone(),
        },
        Direction::OneWayMirror {
            source_device: local.clone(),
        },
    ];
    let trusts = vec![
        Trust::Unclassified,
        Trust::Personal,
        Trust::Shared {
            owner_device: local,
        },
    ];
    let mut fixtures = format!(
        "// Generated real Rust serialization fixtures. Do not edit.\nimport type {{ PolicyView, ExecutionPreview, Direction, Trust }} from './policy';\nexport const policyFixtures: PolicyView[] = {};\nexport const executionFixture: ExecutionPreview = {};\nexport const directionFixtures: Direction[] = {};\nexport const trustFixtures: Trust[] = {};\n",
        serde_json::to_string_pretty(&views)?,
        serde_json::to_string_pretty(&preview)?,
        serde_json::to_string_pretty(&directions)?,
        serde_json::to_string_pretty(&trusts)?
    );
    let conflict_preview = ConflictPreview {
        path: "notes.md".into(),
        versions: vec![
            FilePreview {
                device: "a".repeat(64),
                entry: Some(Entry::File {
                    sha256: "b".repeat(64),
                    bytes: 4,
                }),
                text: Some("<x>\n".into()),
                reason: None,
            },
            FilePreview {
                device: "b".repeat(64),
                entry: None,
                text: None,
                reason: Some("missing".into()),
            },
        ],
    };
    let decisions = vec![
        DecisionRequest {
            path: "notes.md".into(),
            decision: Decision::Use {
                source_device: "a".repeat(64),
            },
        },
        DecisionRequest {
            path: "notes.md".into(),
            decision: Decision::Later,
        },
        DecisionRequest {
            path: "notes.md".into(),
            decision: Decision::IgnoreVersion,
        },
    ];
    let usage = UsageReport {
        enabled: true,
        records: vec![UsageRecord {
            id: "fixture-batch".into(),
            created: 1794328200.0,
            files: 1,
            bytes: "9007199254740993".into(),
        }],
    };
    fixtures.push_str(&format!("\nimport type {{ ConflictPreview, DecisionRequest, UsageReport }} from './policy';\nexport const conflictPreviewFixture: ConflictPreview = {};\nexport const decisionFixtures: DecisionRequest[] = {};\nexport const usageFixture: UsageReport = {};\n", serde_json::to_string_pretty(&conflict_preview)?, serde_json::to_string_pretty(&decisions)?, serde_json::to_string_pretty(&usage)?));
    let destination = root.join("src/generated");
    for (name, contents) in [("policy.ts", types), ("policy-fixtures.ts", fixtures)] {
        let path = destination.join(name);
        if check {
            ensure!(
                fs::read_to_string(&path)
                    .ok()
                    .map(|text| text.replace("\r\n", "\n"))
                    .as_deref()
                    == Some(contents.as_str()),
                "{} drifted; regenerate the policy contract",
                path.display()
            );
        } else {
            fs::create_dir_all(&destination)?;
            fs::write(&path, contents)?;
        }
    }
    println!(
        "Policy contract {}.",
        if check { "verified" } else { "generated" }
    );
    Ok(())
}
