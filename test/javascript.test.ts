import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("javascript: refactors calls into a helper with if/else", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/pi.js": src`
       function createAgentSession(options) {
         AuthStorage.create();
         createCodingTools();
         if (!options.sessionId) {
           SessionManager.create();
         } else {
           SessionManager.open(options.sessionId);
         }
       }
      
      
       function createCodingTools() {}
    `,
  });
  const to = host.commit("after", {
    "/pi.js": src`
       function createAgentSession(options) {
         const services = getServices();
         services.boot();
         if (!options.sessionId) {
           SessionManager.create();
         } else {
           SessionManager.open(options.sessionId);
         }
       }
      
       function getServices() {
         AuthStorage.create();
         createCodingTools();
         return services;
       }
      
       function createCodingTools() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e createAgentSession`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      createAgentSession(options)
    - ├─ AuthStorage.create()
    - ├─ createCodingTools()
    + ├─ getServices()
    + │  ├─ AuthStorage.create()
    + │  └─ createCodingTools()
    + ├─ services.boot()
      ├─ if (!options.sessionId)
         └─ SessionManager.create()
      └─ else
         └─ SessionManager.open()
  `));
});

test("javascript: this.method resolves to Class.method", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/runner.js": src`
       class Runner {
         start() {
           this.prepare();
           this.run();
         }
         prepare() {}
         run() {}
       }
    `,
  });
  const to = host.commit("after", {
    "/runner.js": src`
       class Runner {
         start() {
           this.prepare();
           this.validate();
           this.run();
         }
         prepare() {}
         validate() {}
         run() {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `));
});

test("javascript: new Class() expands through constructor", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/ctor.js": src`
       function make() {
         new Thing();
       }
       class Thing {
         constructor() {
           init();
         }
       }
       function init() {}
    `,
  });
  const to = host.commit("after", {
    "/ctor.js": src`
       function make() {
         new Thing();
       }
       class Thing {
         constructor() {
           init();
           ready();
         }
       }
       function init() {}
       function ready() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e make`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      make()
      └─ new Thing()
         ├─ init()
    +    └─ ready()
  `));
});

test("javascript: nested functions/arrows not attributed to caller", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/nested.js": src`
       function outer() {
         function inner() {
           hidden();
         }
         const f = () => {
           alsoHidden();
         };
         visible();
       }
       function hidden() {}
       function alsoHidden() {}
       function visible() {}
    `,
  });
  const to = host.commit("after", {
    "/nested.js": src`
       function outer() {
         function inner() {
           hidden();
         }
         const f = () => {
           alsoHidden();
         };
         visible();
         alsoVisible();
       }
       function hidden() {}
       function alsoHidden() {}
       function visible() {}
       function alsoVisible() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      outer()
      ├─ visible()
    + └─ alsoVisible()
  `));
});

test("javascript: else-if chains", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/elif.js": src`
       function handle(status) {
         if (status === "a") {
           doA();
         } else if (status === "b") {
           doB();
         } else {
           doOther();
         }
       }
       function doA() {}
       function doB() {}
       function doOther() {}
    `,
  });
  const to = host.commit("after", {
    "/elif.js": src`
       function handle(status) {
         if (status === "a") {
           doA();
         } else if (status === "b") {
           doB();
           doExtra();
         } else {
           doOther();
         }
       }
       function doA() {}
       function doB() {}
       function doExtra() {}
       function doOther() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      handle(status)
      ├─ if (status === "a")
         └─ doA()
      ├─ else if (status === "b")
         ├─ doB()
    +    └─ doExtra()
      └─ else
         └─ doOther()
  `));
});

test("javascript: try/catch/finally and switch as branches", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/ctrl.js": src`
       function boot(x) {
         try {
           open();
         } catch (e) {
           recover();
         } finally {
           close();
         }
         switch (x) {
           case 1:
             doA();
             break;
           default:
             doOther();
         }
       }
       function open() {}
       function recover() {}
       function close() {}
       function doA() {}
       function doOther() {}
    `,
  });
  const to = host.commit("after", {
    "/ctrl.js": src`
       function boot(x) {
         try {
           open();
         } catch (e) {
           recover();
         } finally {
           close();
         }
         switch (x) {
           case 1:
             doA();
             break;
           default:
             doOther();
         }
         flush();
       }
       function open() {}
       function recover() {}
       function close() {}
       function doA() {}
       function doOther() {}
       function flush() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot(x)
      ├─ try
         └─ open()
      ├─ catch (e)
         └─ recover()
      ├─ finally
         └─ close()
      ├─ case 1
         └─ doA()
      ├─ default
         └─ doOther()
    + └─ flush()
  `));
});

test("javascript: ignores computed member calls", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/computed.js": src`
       function run(obj, key) {
         obj[key]();
         obj.known();
       }
    `,
  });
  const to = host.commit("after", {
    "/computed.js": src`
       function run(obj, key) {
         obj[key]();
         obj.known();
         obj.other();
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e run`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      run(obj, key)
      ├─ obj.known()
    + └─ obj.other()
  `));
});

test("javascript: extracts generator and exported arrow bodies", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/gen.js": src`
       export function* gen() {
         yield work();
         done();
       }
       function work() { return 1; }
       function done() {}
    `,
  });
  const to = host.commit("after", {
    "/gen.js": src`
       export function* gen() {
         yield work();
         yield extra();
         done();
       }
       function work() { return 1; }
       function extra() { return 2; }
       function done() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e gen`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      gen()
      ├─ work()
    + ├─ extra()
      └─ done()
  `));
});

test("javascript: const x = yield* Tag resolves x.member() to Tag.member", () => {
  const host = workspace({
    "/svc.js": src`
      class UserRepo {
        find(id) {
          lookup(id);
        }
      }
      function* main() {
        const repo = yield* UserRepo;
        yield* repo.find(1);
      }
      function* sibling() {
        repo.find(2);
      }
    `,
  });

  const bound = host.run("calldiff tree -e main");
  expect(bound.code).toBe(0);
  expect(bound.stdout).toContain("main()\n└─ UserRepo.find(id)\n   └─ lookup()");

  const sibling = host.run("calldiff tree -e sibling");
  expect(sibling.stdout).toContain("repo.find()");
  expect(sibling.stdout).not.toContain("UserRepo.find");
});

test("javascript: lowercase yield* and new Map() do not bind receivers", () => {
  const host = workspace({
    "/neg.js": src`
      function* viaLowercase() {
        const cfg = yield* config;
        cfg.get();
      }
      function viaMap() {
        const m = new Map();
        m.get(1);
      }
    `,
  });

  const lower = host.run("calldiff tree -e viaLowercase");
  expect(lower.stdout).toContain("cfg.get()");
  expect(lower.stdout).not.toContain("config.get");

  const viaMap = host.run("calldiff tree -e viaMap");
  expect(viaMap.stdout).toContain("m.get()");
  expect(viaMap.stdout).not.toContain("Map.get");
});

test("javascript: receiver bindings follow lexical scope", () => {
  const host = workspace({
    "/shadow.js": src`
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

  const run = (entry) => host.run(`calldiff tree -e ${entry}`).stdout;

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
