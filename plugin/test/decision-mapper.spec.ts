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

  it("YELLOW maps to pass-through (undefined); band metadata lives in the audit log", () => {
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
    expect(result).toMatchInlineSnapshot(`undefined`);
  });

  it("ORANGE maps to requireApproval object with title + description + severity", () => {
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
        "requireApproval": {
          "description": "Approve delete of 12 records?",
          "severity": "warning",
          "title": "5D ORANGE: R score=3",
        },
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
      }
    `);
  });

  it("ORANGE falls back to a generated description when no approval_prompt supplied", () => {
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
    expect(result?.requireApproval?.description).toBe(
      "5D ORANGE: dim=A score=3 reason=autonomy spike (approve to proceed)"
    );
    expect(result?.requireApproval?.title).toBe("5D ORANGE: A score=3");
    expect(result?.requireApproval?.severity).toBe("warning");
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
