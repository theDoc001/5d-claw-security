import { describe, it, expect } from "vitest";

import type { BandDecision, PluginConfig } from "../api.ts";
import {
  mapToResult,
  formatBandPrefix
} from "../src/decision-mapper.ts";

const cfg: PluginConfig = {
  policyPath: "/tmp/policy.yaml",
  pythonBin: "python3",
  scoringTimeoutMs: 5000,
  onError: "block"
};

function decision(overrides: Partial<BandDecision> & { band: BandDecision["band"] }): BandDecision {
  return {
    decision_id: "dec-0000",
    ...overrides
  };
}

describe("decision-mapper", () => {
  it("GREEN maps to pass-through (undefined)", () => {
    const result = mapToResult(decision({ band: "GREEN" }), cfg);
    expect(result).toMatchInlineSnapshot(`undefined`);
  });

  it("YELLOW maps to pass with metadata", () => {
    const result = mapToResult(
      decision({
        band: "YELLOW",
        worst_dim: "D",
        worst_score: 2,
        reason: "argument contains base64-looking blob",
        decision_id: "dec-yellow-1"
      }),
      cfg
    );
    expect(result).toMatchInlineSnapshot(`
      {
        "metadata": {
          "fivedrisk": {
            "band": "YELLOW",
            "decision_id": "dec-yellow-1",
            "reason": "argument contains base64-looking blob",
            "worst_dim": "D",
            "worst_score": 2,
          },
        },
      }
    `);
  });

  it("ORANGE maps to requireApproval with prompt", () => {
    const result = mapToResult(
      decision({
        band: "ORANGE",
        worst_dim: "R",
        worst_score: 3,
        reason: "irreversible delete to user data",
        approval_prompt: "Approve delete of 12 records?",
        decision_id: "dec-orange-1"
      }),
      cfg
    );
    expect(result).toMatchInlineSnapshot(`
      {
        "approvalPrompt": "Approve delete of 12 records?",
        "metadata": {
          "fivedrisk": {
            "band": "ORANGE",
            "decision_id": "dec-orange-1",
            "reason": "irreversible delete to user data",
            "worst_dim": "R",
            "worst_score": 3,
          },
        },
        "requireApproval": true,
      }
    `);
  });

  it("RED maps to block with formatted reason", () => {
    const result = mapToResult(
      decision({
        band: "RED",
        worst_dim: "T",
        worst_score: 4,
        reason: "write to /etc/shadow",
        decision_id: "dec-red-1"
      }),
      cfg
    );
    expect(result).toMatchInlineSnapshot(`
      {
        "block": true,
        "blockReason": "5D RED: dim=T score=4 reason=write to /etc/shadow",
        "metadata": {
          "fivedrisk": {
            "band": "RED",
            "decision_id": "dec-red-1",
            "reason": "write to /etc/shadow",
            "worst_dim": "T",
            "worst_score": 4,
          },
        },
      }
    `);
  });

  it("ORANGE falls back to a generated prompt when none supplied", () => {
    const result = mapToResult(
      decision({
        band: "ORANGE",
        worst_dim: "A",
        worst_score: 3,
        reason: "autonomy spike",
        decision_id: "dec-orange-2"
      }),
      cfg
    );
    expect(result?.approvalPrompt).toBe(
      "5D ORANGE: dim=A score=3 reason=autonomy spike (approve to proceed)"
    );
    expect(result?.requireApproval).toBe(true);
  });

  it("formatBandPrefix renders dim/score/reason in the expected shape", () => {
    expect(
      formatBandPrefix(
        decision({
          band: "RED",
          worst_dim: "T",
          worst_score: 4,
          reason: "exec malicious binary"
        })
      )
    ).toBe("5D RED: dim=T score=4 reason=exec malicious binary");
  });

  it("missing worst_dim and reason still produce a safe block string", () => {
    expect(
      formatBandPrefix(
        decision({
          band: "RED"
        })
      )
    ).toBe("5D RED: dim=? score=? reason=(no reason supplied)");
  });
});
