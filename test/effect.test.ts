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

describe("effect: Effect.Service members", () => {
  test("returned members are indexed as Service.member", () => {
    const host = workspace({
      "/svc/repo.ts": src`
        export class UserRepo extends Effect.Service<UserRepo>()("UserRepo", {
          effect: Effect.gen(function* () {
            const audit = (id: string) => record(id)
            const find = Effect.fn("UserRepo.find")(function* (id: string) {
              audit(id)
              return lookup(id)
            })
            return { find, remove: (id: string) => purge(id) } as const
          }),
        }) {}
      `,
    });

    const find = host.run("calldiff tree -e UserRepo.find");
    expect(find.code).toBe(0);
    expect(find.stdout).toContain(src`
      UserRepo.find(id)
      ├─ audit(id)
      │  └─ record()
      └─ lookup()
    `.trimEnd());

    const remove = host.run("calldiff tree -e UserRepo.remove");
    expect(remove.code).toBe(0);
    expect(remove.stdout).toContain("UserRepo.remove(id)\n└─ purge()");

    const file = host.run("calldiff tree --file svc/repo.ts");
    expect(file.code).toBe(0);
    expect(file.stdout).toContain("UserRepo.find(id)");
    expect(file.stdout).toContain("UserRepo.remove(id)");
  });

  test("scoped/succeed/sync keys and identifier implementations resolve", () => {
    const host = workspace({
      "/svc/more.ts": src`
        const make = Effect.gen(function* () {
          const get = (key: string) => fetchKey(key)
          const service = { get }
          return service
        })

        export class Cache extends Effect.Service<Cache>()("Cache", { scoped: make, dependencies: [] }) {}
        export class Clock extends Effect.Service<Clock>()("Clock", { succeed: { now: () => readClock() } }) {}
        export class Ticker extends Effect.Service<Ticker>()("Ticker", { sync: () => ({ tick: () => step() }) }) {}
      `,
    });

    const cache = host.run("calldiff tree -e Cache.get");
    expect(cache.code).toBe(0);
    expect(cache.stdout).toContain("Cache.get(key)\n└─ fetchKey()");

    const clock = host.run("calldiff tree -e Clock.now");
    expect(clock.code).toBe(0);
    expect(clock.stdout).toContain("Clock.now()\n└─ readClock()");

    const ticker = host.run("calldiff tree -e Ticker.tick");
    expect(ticker.code).toBe(0);
    expect(ticker.stdout).toContain("Ticker.tick()\n└─ step()");
  });

  test("only Effect.Service heritage yields members", () => {
    const host = workspace({
      "/svc/neg.ts": src`
        export class Plain extends Base("Plain", {
          effect: Effect.gen(function* () {
            return { find: () => hit() }
          }),
        }) {}
        export class Empty extends Effect.Service<Empty>()("Empty", {
          effect: Effect.gen(function* () {
            init()
          }),
        }) {}
        export class Accessors extends Effect.Service<Accessors>()("Accessors", { accessors: true }) {}
      `,
    });

    const plain = host.run("calldiff tree -e Plain.find");
    expect(plain.code).not.toBe(0);
    expect(`${plain.stdout}\n${plain.stderr}`).toMatch(/Entrypoint not found/);

    const file = host.run("calldiff tree --file svc/neg.ts");
    expect(file.stderr).not.toMatch(/TypeError|RangeError/);
  });
});

describe("effect: Layer-implemented Context.Tag members", () => {
  test("Layer.effect(Tag, gen) members are indexed as Tag.member", () => {
    const host = workspace({
      "/svc/db.ts": src`
        export class Db extends Context.Tag("Db")<Db, { readonly query: (sql: string) => Effect.Effect<number> }>() {}

        export const DbLive = Layer.effect(
          Db,
          Effect.gen(function* () {
            const query = Effect.fn("Db.query")(function* (sql: string) {
              runSql(sql)
            })
            return { query }
          }),
        )
      `,
    });

    const query = host.run("calldiff tree -e Db.query");
    expect(query.code).toBe(0);
    expect(query.stdout).toContain("Db.query(sql)\n└─ runSql()");

    const live = host.run("calldiff tree -e DbLive");
    expect(live.code).toBe(0);
    expect(live.stdout).toContain("DbLive()");
  });

  test("Layer.succeed(this), Layer.sync and piped Layer.scoped resolve", () => {
    const host = workspace({
      "/svc/layers.ts": src`
        export class Mailer extends Context.Tag("Mailer")<Mailer, { readonly send: (to: string) => Effect.Effect<void> }>() {
          static readonly Live = Layer.succeed(this, {
            send: (to: string) => Effect.sync(() => deliver(to)),
          })
        }

        export class Clock extends Context.Tag("Clock")<Clock, { readonly now: () => number }>() {}
        export const ClockLive = Layer.sync(Clock, () => ({ now: () => readClock() }))

        export class Cache extends Context.Tag("Cache")<Cache, { readonly get: (k: string) => Effect.Effect<string> }>() {}
        const makeCache = Effect.gen(function* () {
          const get = (k: string) => fetchKey(k)
          return { get }
        })
        export const CacheLive = Layer.scoped(Cache, makeCache).pipe(Layer.provide(ClockLive))
      `,
    });

    const send = host.run("calldiff tree -e Mailer.send");
    expect(send.code).toBe(0);
    expect(send.stdout).toContain(src`
      Mailer.send(to)
      └─ Effect.sync()
         └─ deliver()
    `.trimEnd());

    const now = host.run("calldiff tree -e Clock.now");
    expect(now.code).toBe(0);
    expect(now.stdout).toContain("Clock.now()\n└─ readClock()");

    const get = host.run("calldiff tree -e Cache.get");
    expect(get.code).toBe(0);
    expect(get.stdout).toContain("Cache.get(k)\n└─ fetchKey()");
  });

  test("Layer calls without a resolvable Tag or outside the set add nothing", () => {
    const host = workspace({
      "/svc/neg.ts": src`
        export class Db extends Context.Tag("Db")<Db, { readonly q: () => void }>() {}
        export const merged = Layer.merge(Db, { leak: () => nope() })
        export const fromCall = Layer.effect(makeTag(), Effect.gen(function* () {
          return { hidden: () => nope() }
        }))
        export function boot() {
          const L = Layer.succeed(Inner, { inner: () => nope() })
          start(L)
        }
      `,
    });

    for (const name of ["Db.leak", "Inner.inner"]) {
      const result = host.run(`calldiff tree -e ${name}`);
      expect(result.code).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(
        /Entrypoint not found/,
      );
    }

    const file = host.run("calldiff tree --file svc/neg.ts");
    expect(file.code).toBe(0);
    expect(file.stdout).not.toContain("hidden(");
  });
});

describe("effect: yield* Tag receivers", () => {
  test("x = yield* Tag makes x.member() resolve to Tag.member", () => {
    const host = workspace({
      "/svc/app.ts": src`
        export class Db extends Context.Tag("Db")<Db, { readonly query: (sql: string) => Effect.Effect<number> }>() {}
        export const DbLive = Layer.effect(Db, Effect.gen(function* () {
          const query = (sql: string) => runSql(sql)
          return { query }
        }))

        export class UserRepo extends Effect.Service<UserRepo>()("UserRepo", {
          effect: Effect.gen(function* () {
            const db = yield* Db
            const find = Effect.fn("UserRepo.find")(function* (id: string) {
              yield* db.query(id)
            })
            return { find, remove: (id: string) => db.query(id) }
          }),
        }) {}

        export const main = Effect.gen(function* () {
          const repo = yield* UserRepo
          yield* repo.find("1")
          yield* Effect.forEach(["2"], (id) => repo.remove(id))
          yield* repo.missing()
        })
      `,
    });

    const result = host.run("calldiff tree -e main");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(src`
      main()
      ├─ UserRepo.find(id)
      │  └─ Db.query(sql)
      │     └─ runSql()
      ├─ Effect.forEach()
      │  └─ UserRepo.remove(id)
      │     └─ Db.query(sql)
      │        └─ runSql()
      └─ UserRepo.missing()
    `.trimEnd());
  });

  test("only delegated yields of PascalCase identifiers bind", () => {
    const host = workspace({
      "/svc/neg.ts": src`
        export class UserRepo {
          find() {
            hit()
          }
        }
        export function viaMap() {
          const m = new Map()
          m.get("k")
        }
        export const viaLowercase = Effect.gen(function* () {
          const cfg = yield* config
          cfg.load()
        })
        export const viaPlainYield = Effect.gen(function* () {
          const svc = yield UserRepo
          svc.find()
        })
        export const binder = Effect.gen(function* () {
          const repo = yield* UserRepo
          repo.find()
        })
        export const sibling = Effect.gen(function* () {
          repo.find()
        })
      `,
    });

    const viaMap = host.run("calldiff tree -e viaMap");
    expect(viaMap.stdout).toContain("m.get()");
    expect(viaMap.stdout).not.toContain("Map.get");

    const viaLowercase = host.run("calldiff tree -e viaLowercase");
    expect(viaLowercase.stdout).toContain("cfg.load()");
    expect(viaLowercase.stdout).not.toContain("config.load");

    const viaPlainYield = host.run("calldiff tree -e viaPlainYield");
    expect(viaPlainYield.stdout).toContain("svc.find()");
    expect(viaPlainYield.stdout).not.toContain("UserRepo.find");

    const sibling = host.run("calldiff tree -e sibling");
    expect(sibling.stdout).toContain("repo.find()");
    expect(sibling.stdout).not.toContain("UserRepo.find");

    const binder = host.run("calldiff tree -e binder");
    expect(binder.stdout).toContain("binder()\n└─ UserRepo.find()\n   └─ hit()");
  });

  test("a function's own binding beats one inside a nested helper", () => {
    const host = workspace({
      "/svc/scope.ts": src`
        export const outer = Effect.gen(function* () {
          function* viaReplica() {
            const db = yield* Replica
            db.query()
          }
          const db = yield* Db
          db.query()
          yield* viaReplica()
        })
      `,
    });

    const result = host.run("calldiff tree -e outer");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(src`
      outer()
      ├─ Db.query()
      └─ viaReplica()
         └─ Replica.query()
    `.trimEnd());
    expect(result.stdout).not.toContain("db.query()");
  });
});

describe("effect: lexical scoping of receiver bindings", () => {
  test("shadowing declarations beat an Effect binding; closures still resolve", () => {
    const host = workspace({
      "/svc/shadow.ts": src`
        function* localVsNested() {
          const repo = makeRepo()
          repo.find()
          yield* Effect.forEach([1], function* () {
            const repo = yield* UserRepo
            repo.find()
          })
        }
        function* arrowParam() {
          const db = yield* Db
          list.map((db) => db.query())
        }
        function* destructuredParam() {
          const db = yield* Db
          list.map(({ db }) => db.query())
          list.map(([db]) => db.query())
          list.map((x, { y: db } = {}) => db.query())
        }
        function* catchParam() {
          const db = yield* Db
          try {
            risky()
          } catch (db) {
            db.query()
          }
        }
        function* forOf() {
          const db = yield* Db
          for (const db of dbs) {
            db.query()
          }
        }
        function* innerBlock() {
          const db = yield* Db
          {
            const db = makeDb()
            db.query()
          }
          db.ping()
        }
        function* closure() {
          const db = yield* Db
          list.map((row) => db.query(row))
        }
      `,
    });

    const run = (entry: string) => host.run(`calldiff tree -e ${entry}`).stdout;

    const local = run("localVsNested");
    expect(local).toContain("repo.find()");
    expect(local).toContain("UserRepo.find()");
    expect(local.match(/repo\.find\(\)/g)).toHaveLength(1);
    for (const entry of ["arrowParam", "destructuredParam"]) {
      const out = run(entry);
      expect(out).toContain("db.query()");
      expect(out).not.toContain("Db.query");
    }
    const caught = run("catchParam");
    expect(caught).toContain("db.query()");
    expect(caught).not.toContain("Db.query");
    const loop = run("forOf");
    expect(loop).toContain("db.query()");
    expect(loop).not.toContain("Db.query");
    const block = run("innerBlock");
    expect(block).toContain("db.query()");
    expect(block).toContain("Db.ping()");
    expect(block).not.toContain("Db.query");
    const closure = run("closure");
    expect(closure).toContain("Db.query()");
    expect(closure).not.toContain("db.query");
  });

  test("for (var x of …) hoists to the function; a kindless loop head declares nothing", () => {
    const host = workspace({
      "/svc/loops.ts": src`
        function* varLoop() {
          const db = yield* Db
          list.forEach(() => {
            db.query()
            for (var db of dbs) {
              touch(db)
            }
          })
        }
        function* bareLoop() {
          let db = yield* Db
          for (db of dbs) {
            db.ping()
          }
        }
      `,
    });

    const hoisted = host.run("calldiff tree -e varLoop").stdout;
    expect(hoisted).toContain("db.query()");
    expect(hoisted).not.toContain("Db.query");
    const bare = host.run("calldiff tree -e bareLoop").stdout;
    expect(bare).toContain("Db.ping()");
    expect(bare).not.toContain("db.ping");
  });
});
