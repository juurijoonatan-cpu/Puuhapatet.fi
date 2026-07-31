import { describe, expect, it } from "vitest";
import { classifyError, isMissingTable, fail } from "./errors";

describe("classifyError — palveluntarjoajan kiintiö", () => {
  it("tunnistaa Supabasen siirtokiintiöviestin eikä päästä sitä läpi", () => {
    // Tämä on SE viesti joka näkyi kirjautumisruudulla.
    const e = new Error("Your project has exceeded the data transfer quota. Upgrade your plan to increase limits.");
    const safe = classifyError(e);
    expect(safe.code).toBe("db_quota");
    expect(safe.status).toBe(503);
    expect(safe.message).not.toMatch(/quota|Upgrade|plan/i);
    expect(safe.message).toMatch(/tietokanta/i);
  });

  it("tunnistaa kiintiön myös toisin sanoin", () => {
    expect(classifyError(new Error("egress limit exceeded for project")).code).toBe("db_quota");
    expect(classifyError(new Error("Bandwidth quota exceeded")).code).toBe("db_quota");
  });
});

describe("classifyError — yhteysvirheet", () => {
  it.each(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "53300"])(
    "%s → db_unavailable 503",
    (code) => {
      const e = Object.assign(new Error("boom"), { code });
      const safe = classifyError(e);
      expect(safe.code).toBe("db_unavailable");
      expect(safe.status).toBe(503);
    },
  );

  it("tunnistaa yhteysvirheen myös pelkästä viestistä", () => {
    expect(classifyError(new Error("Connection terminated unexpectedly")).code).toBe("db_unavailable");
  });
});

describe("classifyError — skeema ja ristiriidat", () => {
  it("42P01 (taulua ei ole) → db_schema, ei paljasta taulun nimeä", () => {
    const e = Object.assign(new Error('relation "era_invoices" does not exist'), { code: "42P01" });
    const safe = classifyError(e);
    expect(safe.code).toBe("db_schema");
    expect(safe.message).not.toMatch(/era_invoices|relation/);
  });

  it("23505 (uniikkiehto) → 409", () => {
    const e = Object.assign(new Error("duplicate key"), { code: "23505" });
    expect(classifyError(e).status).toBe(409);
  });

  it("isMissingTable erottaa 42P01:n muista", () => {
    expect(isMissingTable(Object.assign(new Error("x"), { code: "42P01" }))).toBe(true);
    expect(isMissingTable(Object.assign(new Error("x"), { code: "23505" }))).toBe(false);
    expect(isMissingTable(new Error("x"))).toBe(false);
  });
});

describe("classifyError — tuntematon virhe ei vuoda sisältöään", () => {
  it("SQL-lause ja tiedostopolku eivät päädy viestiin", () => {
    const e = new Error('select * from users where password_hash = $1 -- /srv/app/server/routes.ts:1330');
    const safe = classifyError(e);
    expect(safe.status).toBe(500);
    expect(safe.code).toBe("server_error");
    expect(safe.message).not.toMatch(/select|password_hash|routes\.ts/);
  });

  it("kestää null/undefined/merkkijonon", () => {
    expect(classifyError(null).code).toBe("server_error");
    expect(classifyError(undefined).code).toBe("server_error");
    expect(classifyError("jokin meni pieleen").code).toBe("server_error");
  });
});

describe("fail", () => {
  it("vastaa luokitellulla statuksella ja koodilla", () => {
    let captured: { status?: number; body?: any } = {};
    const res = {
      status(code: number) {
        captured.status = code;
        return { json(body: unknown) { captured.body = body; return body; } };
      },
    };
    const err = new Error("Your project has exceeded the data transfer quota.");
    // console.error on tarkoituksellinen — todellinen syy kuuluu lokiin.
    const original = console.error;
    console.error = () => {};
    try { fail(res, err, "POST /api/admin/login"); } finally { console.error = original; }
    expect(captured.status).toBe(503);
    expect(captured.body.code).toBe("db_quota");
    expect(captured.body.error).not.toMatch(/quota/i);
  });
});
