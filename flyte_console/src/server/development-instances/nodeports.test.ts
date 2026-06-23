import { describe, expect, it } from "vitest";
import { extractNodePorts } from "./nodeports";

describe("development instance nodeport API helpers", () => {
  it("extracts unique NodePorts from Kubernetes service lists", () => {
    expect(
      extractNodePorts({
        items: [
          { spec: { ports: [{ nodePort: 31000 }, { nodePort: 31001 }] } },
          { spec: { ports: [{ nodePort: 31000 }, { port: 22 }] } },
        ],
      }),
    ).toEqual([31000, 31001]);
  });
});
