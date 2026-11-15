// Generated real Rust serialization fixtures. Do not edit.
import type { PolicyView, ExecutionPreview, Direction, Trust } from './policy';
export const policyFixtures: PolicyView[] = [
  {
    "task": "10c53fe88d1bef1acd1b226af2c50d2e46ac3902b263e55f8c6b65cb73a13fad",
    "state": {
      "current": {
        "task": "10c53fe88d1bef1acd1b226af2c50d2e46ac3902b263e55f8c6b65cb73a13fad",
        "revision": 0,
        "endpoints": [
          {
            "device": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "grant": "00000000-0000-0000-0000-000000000001"
          },
          {
            "device": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "grant": "00000000-0000-0000-0000-000000000002"
          }
        ],
        "direction": {
          "mode": "bidirectional"
        },
        "trigger": "manual",
        "trust": {
          "kind": "unclassified"
        },
        "conflicts": {
          "kind": "hold"
        },
        "excludes": [],
        "deletion": {
          "max_files": 100,
          "relative_min": 10,
          "percent": 20,
          "window_seconds": 600
        }
      },
      "pending": null,
      "last_receipt": null
    },
    "paused": false
  },
  {
    "task": "10c53fe88d1bef1acd1b226af2c50d2e46ac3902b263e55f8c6b65cb73a13fad",
    "state": {
      "current": {
        "task": "10c53fe88d1bef1acd1b226af2c50d2e46ac3902b263e55f8c6b65cb73a13fad",
        "revision": 0,
        "endpoints": [
          {
            "device": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "grant": "00000000-0000-0000-0000-000000000001"
          },
          {
            "device": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "grant": "00000000-0000-0000-0000-000000000002"
          }
        ],
        "direction": {
          "mode": "bidirectional"
        },
        "trigger": "manual",
        "trust": {
          "kind": "unclassified"
        },
        "conflicts": {
          "kind": "hold"
        },
        "excludes": [],
        "deletion": {
          "max_files": 100,
          "relative_min": 10,
          "percent": 20,
          "window_seconds": 600
        }
      },
      "pending": {
        "proposal": {
          "id": "00000000-0000-0000-0000-000000000003",
          "expected_revision": 0,
          "next": {
            "task": "10c53fe88d1bef1acd1b226af2c50d2e46ac3902b263e55f8c6b65cb73a13fad",
            "revision": 1,
            "endpoints": [
              {
                "device": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "grant": "00000000-0000-0000-0000-000000000001"
              },
              {
                "device": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "grant": "00000000-0000-0000-0000-000000000002"
              }
            ],
            "direction": {
              "mode": "bidirectional"
            },
            "trigger": "manual",
            "trust": {
              "kind": "personal"
            },
            "conflicts": {
              "kind": "hold"
            },
            "excludes": [],
            "deletion": {
              "max_files": 100,
              "relative_min": 10,
              "percent": 20,
              "window_seconds": 600
            }
          },
          "proposed_by": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        },
        "accepted": false
      },
      "last_receipt": null
    },
    "paused": false
  },
  {
    "task": "10c53fe88d1bef1acd1b226af2c50d2e46ac3902b263e55f8c6b65cb73a13fad",
    "state": {
      "current": {
        "task": "10c53fe88d1bef1acd1b226af2c50d2e46ac3902b263e55f8c6b65cb73a13fad",
        "revision": 1,
        "endpoints": [
          {
            "device": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "grant": "00000000-0000-0000-0000-000000000001"
          },
          {
            "device": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "grant": "00000000-0000-0000-0000-000000000002"
          }
        ],
        "direction": {
          "mode": "bidirectional"
        },
        "trigger": "manual",
        "trust": {
          "kind": "personal"
        },
        "conflicts": {
          "kind": "hold"
        },
        "excludes": [],
        "deletion": {
          "max_files": 100,
          "relative_min": 10,
          "percent": 20,
          "window_seconds": 600
        }
      },
      "pending": null,
      "last_receipt": {
        "proposal": "00000000-0000-0000-0000-000000000003",
        "digest": "237f78e68da3f87bb00451d249c1c13f69f99a78d81afd4b3ae80d4189741884",
        "outcome": "committed"
      }
    },
    "paused": true
  }
];
export const executionFixture: ExecutionPreview = {
  "plan": "00000000-0000-0000-0000-000000000004",
  "digest": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "selection_digest": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "risks": [
    {
      "device": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "planned_deletions": 103,
      "selected_deletions": 9,
      "recent_deletions": 0,
      "baseline_files": 104,
      "reasons": [
        "large_deletion",
        "relative_deletion"
      ]
    }
  ],
  "approval_required": true,
  "selected": [
    "example.txt"
  ]
};
export const directionFixtures: Direction[] = [
  {
    "mode": "bidirectional"
  },
  {
    "mode": "one_way_update",
    "source_device": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  {
    "mode": "one_way_mirror",
    "source_device": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
];
export const trustFixtures: Trust[] = [
  {
    "kind": "unclassified"
  },
  {
    "kind": "personal"
  },
  {
    "kind": "shared",
    "owner_device": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
];

import type { ConflictPreview, DecisionRequest, UsageReport } from './policy';
export const conflictPreviewFixture: ConflictPreview = {
  "path": "notes.md",
  "versions": [
    {
      "device": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "entry": {
        "type": "file",
        "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "bytes": 4
      },
      "text": "<x>\n",
      "reason": null
    },
    {
      "device": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "entry": null,
      "text": null,
      "reason": "missing"
    }
  ]
};
export const decisionFixtures: DecisionRequest[] = [
  {
    "path": "notes.md",
    "decision": {
      "choice": "use",
      "source_device": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  },
  {
    "path": "notes.md",
    "decision": {
      "choice": "later"
    }
  },
  {
    "path": "notes.md",
    "decision": {
      "choice": "ignore_version"
    }
  }
];
export const usageFixture: UsageReport = {
  "enabled": true,
  "records": [
    {
      "id": "fixture-batch",
      "created": 1794328200.0,
      "files": 1,
      "bytes": "9007199254740993"
    }
  ]
};
