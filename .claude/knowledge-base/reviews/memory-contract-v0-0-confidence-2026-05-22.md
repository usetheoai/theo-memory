{
  "plan_slug": "memory-contract-v0-0",
  "plan_path": "/home/paulo/Projetos/usetheo/theo-memory/.claude/knowledge-base/plans/memory-contract-v0-0-plan.md",
  "plan_version": "1.2",
  "scored_at": "2026-05-22T20:19:07+00:00",
  "completude_score": 100.0,
  "risco_estrutural_score": 100.0,
  "active_dimensions": [
    "completude",
    "risco_estrutural"
  ],
  "weight_normalization_factor": 2.0,
  "weighted_avg": 100.0,
  "hard_caps_triggered": [],
  "final_score_after_caps": 100.0,
  "verdict": "SHIPPABLE",
  "motivos": {
    "completude": [
      {
        "sign": "positive",
        "label": "Coverage Matrix 100%",
        "weight": 60.0
      },
      {
        "sign": "positive",
        "label": "ADR alternatives (9/9)",
        "weight": 20.0
      },
      {
        "sign": "positive",
        "label": "TDD in bug-fix (0/0)",
        "weight": 20.0
      }
    ],
    "evidencia": [],
    "calibracao": [],
    "risco_estrutural": []
  },
  "sub_reports": {
    "coverage_matrix": {
      "total_gaps": 31,
      "mapped_gaps": 31,
      "coverage_ratio": 1.0,
      "is_complete": true,
      "orphan_tasks": [],
      "unmapped_gaps": []
    },
    "adr_completeness": {
      "total_adrs": 9,
      "with_alternatives": 9,
      "completeness_ratio": 1.0,
      "missing_alternatives": []
    },
    "tdd_in_bugfix": {
      "total_bugfix_tasks": 0,
      "with_tdd": 0,
      "coverage_ratio": 1.0,
      "missing_tdd": []
    },
    "spec_smells": {
      "total_hits": 0,
      "by_category": {},
      "total_penalty": 0
    },
    "architecture_compliance": {
      "compliance_score": 1.0,
      "project_rules_found_count": 16,
      "fallback_to_defaults": false,
      "rules_referenced_in_plan": [
        "architecture.md",
        "audit-trail-rotation.md",
        "cycle-implement.md",
        "cycle-plan.md",
        "deps-audit-golden-rule.md",
        "dogfood-golden-rule.md",
        "public-copy.md",
        "testing.md"
      ],
      "principles_cited": [
        "LSP",
        "ISP",
        "DIP",
        "SOLID",
        "TDD"
      ],
      "has_dod_quality_signal": true,
      "has_size_budget_signal": true,
      "motivos": [
        "References 8 project rule(s): ['architecture.md', 'audit-trail-rotation.md', 'cycle-implement.md']",
        "Cites 5 principle(s): ['LSP', 'ISP', 'DIP']",
        "Global DoD references quality gates (lint/complexity/size)",
        "Plan mentions file-size budget"
      ]
    }
  },
  "calibration": {
    "status": "PROVISIONAL_v1",
    "holdout_count": 0,
    "holdout_target": 30,
    "kappa_measured": false
  },
  "code_quality": {
    "verdict": "PASS",
    "score_cap": 100,
    "hard_caps_triggered": [],
    "soft_caps_triggered": [],
    "languages_audited": []
  }
}
