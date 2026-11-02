import { describe, expect, it } from "vitest";
import demoRecords from "@/lib/demo-records.json";
import { parseAssetId } from "@/lib/config";
import { EXAMPLE_ASSET_ID } from "@/hooks/use-verify-asset";

describe("the advertised example record", () => {
  it("is a well-formed asset ID", () => {
    expect(() => parseAssetId(EXAMPLE_ASSET_ID)).not.toThrow();
  });

  it("is one of the records the demo seed actually registered", () => {
    // The constant used to be a literal that had never been registered on
    // chain, so "use the example" — the advertised first run — landed on a 404.
    // Tying it to the seed file makes that class of drift impossible: if the
    // seed regenerates to different IDs, the example moves with it.
    const seeded = demoRecords.records.map((record) => record.assetId).filter(Boolean);
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded).toContain(EXAMPLE_ASSET_ID);
  });
});
