import { outdent } from "outdent";
import { describe, expect, test } from "vitest";
import { workspace } from "./workspace.js";

/** Keep the trailing newline so expectations match CLI stdout. */
const src = outdent({ trimTrailingNewline: false });

/**
 * Effect-TS defines callables as class fields wrapped in `Effect.fn`, as
 * members of service constructions, and reaches them through `yield* Tag`
 * receivers. Before this none of them were indexed, so `tree` could neither
 * start from a service member nor follow a call into one.
 */
describe("effect: class fields initialised with wrapper calls", () => {
  const svc = src`
    export class Svc {
      readonly run = Effect.fn("Svc.run")(function* () {
        yield* named("z")
      })
      static readonly traced = Effect.fnUntraced(function* (id: string) {
        leaf(id)
      })
      readonly ping = () => leaf("ping")
    }

    function named(id: string) {
      leaf(id)
    }
  `;

  test("a field wrapped in Effect.fn is indexed as Class.field", () => {
    const host = workspace({ "/svc/svc.ts": svc });

    const run = host.run("calldiff tree -e Svc.run");
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(src`
      Svc.run()
      └─ named(id)
         └─ leaf()
    `.trimEnd());

    const traced = host.run("calldiff tree -e Svc.traced");
    expect(traced.code).toBe(0);
    expect(traced.stdout).toContain("Svc.traced(id)\n└─ leaf()");

    const ping = host.run("calldiff tree -e Svc.ping");
    expect(ping.code).toBe(0);
    expect(ping.stdout).toContain("Svc.ping()\n└─ leaf()");
  });

  test("wrapped class fields are --file entrypoints", () => {
    const host = workspace({ "/svc/svc.ts": svc });

    const result = host.run("calldiff tree --file svc/svc.ts");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Svc.ping()");
    expect(result.stdout).toContain("Svc.run()");
    expect(result.stdout).toContain("Svc.traced(id)");
  });

  test("fields without a function are not indexed", () => {
    const host = workspace({
      "/svc/svc.ts": src`
        export class Svc {
          count = compute()
          label = "x"
          readonly alias = wrap(existing)
        }
      `,
    });

    for (const name of ["Svc.count", "Svc.label", "Svc.alias"]) {
      const result = host.run(`calldiff tree -e ${name}`);
      expect(result.code).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(
        /Entrypoint not found/,
      );
    }
  });
});
