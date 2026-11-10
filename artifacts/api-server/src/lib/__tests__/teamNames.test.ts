import { describe, it, expect } from "vitest";
import { displayTeamName } from "../teamNames";

describe("displayTeamName (push alert titles)", () => {
  it("1: names the Olympic-cycle squads as the Olympic team, and leaves every other team as stored", () => {
    expect(displayTeamName("USA U21")).toBe("USA Olympic Team");
    expect(displayTeamName("United States U23")).toBe("USA Olympic Team");
    expect(displayTeamName("USA U20")).toBe("USA U20");
    expect(displayTeamName("Ukraine U21")).toBe("Ukraine U21");
    expect(displayTeamName("USA")).toBe("USA");
  });
});
