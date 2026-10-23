// Church System server (made to run on Vercel)
//
// Everything private lives in Vercel's settings, not in this file:
//   DATABASE_URL     - added automatically when you connect a Neon database
//   ADMIN_PASSWORD   - the password people type to open the system
//   SESSION_SECRET   - any long random text (40+ characters), keeps logins safe

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool, types } = require("pg");

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const ON_VERCEL = !!process.env.VERCEL;

// ---------- THE PAGES ----------
// Read once when the server starts. The dashboard files are NOT in a "public"
// folder on purpose: Vercel would show a public folder to everyone, with no password.
const dashboard = {
  html: fs.readFileSync(path.join(process.cwd(), "app", "index.html")),
  js: fs.readFileSync(path.join(process.cwd(), "app", "script.js")),
  css: fs.readFileSync(path.join(process.cwd(), "app", "style.css")),
  logo: fs.readFileSync(path.join(process.cwd(), "app", "st-benedict.jpg")),
  login: fs.readFileSync(path.join(process.cwd(), "login.html"))
};

// ---------- DATABASE ----------

// Dates come back as plain "2026-10-19" text
types.setTypeParser(1082, function (value) {
  return value;
});

const pool = new Pool({ connectionString: DATABASE_URL, max: 3 });

// Write queries with ? and they are turned into $1, $2, ... for Postgres
function toPg(sql) {
  let n = 0;
  return sql.replace(/\?/g, function () {
    n++;
    return "$" + n;
  });
}

function db(sql, params) {
  return pool.query(toPg(sql), params);
}

// Run several queries together: all of them happen, or none
async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (e) {
      // ignore
    }
    throw err;
  } finally {
    client.release();
  }
}

function inTx(client, sql, params) {
  return client.query(toPg(sql), params);
}

// The tables are created automatically the first time the server runs
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS members (
    id SERIAL PRIMARY KEY,
    membership_number VARCHAR(50) NOT NULL UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100),
    sur_name VARCHAR(100) NOT NULL,
    dob DATE,
    gender VARCHAR(10),
    pob VARCHAR(150),
    home_town VARCHAR(150),
    father VARCHAR(150),
    mother VARCHAR(150),
    status VARCHAR(10) NOT NULL DEFAULT 'Active',
    association VARCHAR(150),
    leadership VARCHAR(255),
    baptised VARCHAR(3) NOT NULL DEFAULT 'No',
    baptism_date DATE,
    baptism_by VARCHAR(150),
    baptism_place VARCHAR(150),
    baptism_god VARCHAR(150),
    communion VARCHAR(3) NOT NULL DEFAULT 'No',
    communion_date DATE,
    communion_by VARCHAR(150),
    communion_place VARCHAR(150),
    confirmed VARCHAR(3) NOT NULL DEFAULT 'No',
    confirmation_date DATE,
    confirmation_by VARCHAR(150),
    confirmation_place VARCHAR(150),
    confirmation_god VARCHAR(150),
    married VARCHAR(3) NOT NULL DEFAULT 'No',
    spouse VARCHAR(150),
    marriage_date DATE,
    marriage_place VARCHAR(150),
    marriage_by VARCHAR(150),
    transferred VARCHAR(3) NOT NULL DEFAULT 'No',
    transfer_parish VARCHAR(150),
    transfer_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS associations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    males INT NOT NULL DEFAULT 0,
    females INT NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS executives (
    id SERIAL PRIMARY KEY,
    association_id INT NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    title VARCHAR(100),
    phone VARCHAR(30) NOT NULL,
    email VARCHAR(150)
  )`,
  `CREATE TABLE IF NOT EXISTS offerings (
    id SERIAL PRIMARY KEY,
    occasion VARCHAR(150) NOT NULL,
    offering_date DATE NOT NULL,
    amount NUMERIC(12,2) NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    ip TEXT PRIMARY KEY,
    attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ
  )`
];

let schemaReady = null;

function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async function () {
      for (const sql of SCHEMA) {
        await pool.query(sql);
      }
    })().catch(function (err) {
      schemaReady = null; // try again next time
      throw err;
    });
  }
  return schemaReady;
}

// ---------- SMALL HELPERS ----------

// Wrap a route: make sure the database is ready, and give clean errors
function route(handler) {
  return function (req, res) {
    if (!DATABASE_URL) {
      return res.status(500).json({
        error: "The database is not connected yet. In Vercel, open the Storage tab and add a database."
      });
    }
    ensureSchema()
      .then(function () {
        return handler(req, res);
      })
      .catch(function (err) {
        console.error(err);
        res.status(500).json({ error: "Something went wrong on the server." });
      });
  };
}

// Trim text; an empty box becomes null (so an empty date is saved as empty)
function text(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

// ---------- LOGIN ----------
// A login is a cookie signed with SESSION_SECRET. Nothing is kept in the server's
// memory, so it works on Vercel where every request can reach a different copy.

const COOKIE_NAME = "church_session";
const SESSION_HOURS = 12;

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function makeToken() {
  const expires = String(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  return expires + "." + sign(expires);
}

function tokenIsValid(token) {
  if (!token || !SESSION_SECRET) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const given = Buffer.from(parts[1]);
  const expected = Buffer.from(sign(parts[0]));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return false;
  }
  return Number(parts[0]) > Date.now();
}

function readCookie(req, name) {
  const pieces = (req.headers.cookie || "").split(";");
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i].trim();
    if (piece.indexOf(name + "=") === 0) {
      return piece.slice(name.length + 1);
    }
  }
  return null;
}

function isLoggedIn(req) {
  return tokenIsValid(readCookie(req, COOKIE_NAME));
}

function setCookie(res, value, seconds) {
  let cookie = COOKIE_NAME + "=" + value + "; HttpOnly; SameSite=Lax; Path=/; Max-Age=" + seconds;
  if (ON_VERCEL) {
    cookie += "; Secure"; // only sent over https
  }
  res.setHeader("Set-Cookie", cookie);
}

function passwordMatches(given) {
  const a = crypto.createHash("sha256").update(String(given)).digest();
  const b = crypto.createHash("sha256").update(String(ADMIN_PASSWORD)).digest();
  return crypto.timingSafeEqual(a, b);
}

// After 5 wrong passwords, that computer must wait 15 minutes.
// The count is kept in the database so it works on Vercel too.
async function lockedMinutes(ip) {
  const result = await db("SELECT locked_until FROM login_attempts WHERE ip = ?", [ip]);
  if (result.rows.length && result.rows[0].locked_until) {
    const until = new Date(result.rows[0].locked_until).getTime();
    if (until > Date.now()) {
      return Math.ceil((until - Date.now()) / 60000);
    }
  }
  return 0;
}

async function recordFailure(ip) {
  const result = await db("SELECT attempts, locked_until FROM login_attempts WHERE ip = ?", [ip]);

  let attempts = 1;
  if (result.rows.length) {
    const row = result.rows[0];
    const lockEnded = row.locked_until && new Date(row.locked_until).getTime() <= Date.now();
    attempts = lockEnded ? 1 : row.attempts + 1;
  }

  let lockUntil = null;
  if (attempts >= 5) {
    lockUntil = new Date(Date.now() + 15 * 60 * 1000);
    attempts = 0;
  }

  await db(
    "INSERT INTO login_attempts (ip, attempts, locked_until) VALUES (?, ?, ?) " +
    "ON CONFLICT (ip) DO UPDATE SET attempts = EXCLUDED.attempts, locked_until = EXCLUDED.locked_until",
    [ip, attempts, lockUntil]
  );
}

// ---------- THE APP ----------

const app = express();
app.set("trust proxy", 1);
app.use(express.json());

// Only the login page and the logo are open to everyone
app.get("/login", function (req, res) {
  if (isLoggedIn(req)) {
    return res.redirect("/");
  }
  res.type("html").send(dashboard.login);
});

app.get("/st-benedict.jpg", function (req, res) {
  res.type("jpg").send(dashboard.logo);
});

app.post("/login", route(async function (req, res) {
  if (!ADMIN_PASSWORD || !SESSION_SECRET) {
    return res.status(500).json({
      error: "The system is not set up yet. In Vercel, add the ADMIN_PASSWORD and SESSION_SECRET settings."
    });
  }

  const ip = req.ip || "unknown";

  const wait = await lockedMinutes(ip);
  if (wait > 0) {
    return res.status(429).json({ error: "Too many wrong attempts. Try again in " + wait + " minute(s)." });
  }

  const password = req.body && req.body.password;
  if (typeof password !== "string" || !passwordMatches(password)) {
    await recordFailure(ip);
    return res.status(401).json({ error: "Wrong password." });
  }

  await db("DELETE FROM login_attempts WHERE ip = ?", [ip]);
  setCookie(res, makeToken(), SESSION_HOURS * 60 * 60);
  res.json({ ok: true });
}));

app.post("/logout", function (req, res) {
  setCookie(res, "", 0);
  res.json({ ok: true });
});

// Everything below this line needs the password
app.use(function (req, res, next) {
  if (isLoggedIn(req)) {
    return next();
  }
  if (req.path.indexOf("/api") === 0) {
    return res.status(401).json({ error: "Please log in." });
  }
  res.redirect("/login");
});

// The dashboard itself
app.get(["/", "/index.html"], function (req, res) {
  res.type("html").send(dashboard.html);
});

app.get("/script.js", function (req, res) {
  res.type("js").send(dashboard.js);
});

app.get("/style.css", function (req, res) {
  res.type("css").send(dashboard.css);
});

// ---------- MEMBERS ----------

// dashboard field name  ->  database column name
const memberMap = {
  membershipNumber: "membership_number",
  firstName: "first_name",
  middleName: "middle_name",
  surName: "sur_name",
  dob: "dob",
  gender: "gender",
  pob: "pob",
  homeTown: "home_town",
  father: "father",
  mother: "mother",
  status: "status",
  association: "association",
  leadership: "leadership",
  baptised: "baptised",
  baptismDate: "baptism_date",
  baptismBy: "baptism_by",
  baptismPlace: "baptism_place",
  baptismGod: "baptism_god",
  communion: "communion",
  firstcommunionDate: "communion_date",
  firstCommunionBy: "communion_by",
  firstcommunionPlace: "communion_place",
  confirmed: "confirmed",
  confirmationDate: "confirmation_date",
  confirmationBy: "confirmation_by",
  confirmationPlace: "confirmation_place",
  confirmationGod: "confirmation_god",
  married: "married",
  spouse: "spouse",
  marriageDate: "marriage_date",
  marriagePlace: "marriage_place",
  marriageBy: "marriage_by",
  transferred: "transferred",
  transferParish: "transfer_parish",
  transferDate: "transfer_date"
};

// Used when one of these is left empty
const memberDefaults = {
  status: "Active",
  baptised: "No",
  communion: "No",
  confirmed: "No",
  married: "No",
  transferred: "No"
};

// A database row -> the object the dashboard expects
function memberToJs(row) {
  const m = { id: row.id };
  Object.keys(memberMap).forEach(function (js) {
    const value = row[memberMap[js]];
    m[js] = value === null ? "" : value;
  });
  return m;
}

// What the dashboard sent -> the columns and values to save
function memberToDb(body) {
  const columns = [];
  const values = [];
  Object.keys(memberMap).forEach(function (js) {
    let value = text(body[js]);
    if (value === null && memberDefaults[js] !== undefined) {
      value = memberDefaults[js];
    }
    columns.push(memberMap[js]);
    values.push(value);
  });
  return { columns: columns, values: values };
}

function memberProblem(body) {
  if (!text(body.membershipNumber) || !text(body.firstName) || !text(body.surName)) {
    return "Membership number, first name and sur name are required.";
  }
  return null;
}

const DUPLICATE_MEMBER = "Another member already has this membership number.";

app.get("/api/members", route(async function (req, res) {
  const result = await db("SELECT * FROM members ORDER BY id");
  res.json(result.rows.map(memberToJs));
}));

app.post("/api/members", route(async function (req, res) {
  const problem = memberProblem(req.body);
  if (problem) {
    return res.status(400).json({ error: problem });
  }

  const data = memberToDb(req.body);
  const marks = data.columns.map(function () { return "?"; }).join(", ");

  try {
    const result = await db(
      "INSERT INTO members (" + data.columns.join(", ") + ") VALUES (" + marks + ") RETURNING id",
      data.values
    );
    res.status(201).json({ id: result.rows[0].id });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: DUPLICATE_MEMBER });
    }
    throw err;
  }
}));

app.put("/api/members/:id", route(async function (req, res) {
  const problem = memberProblem(req.body);
  if (problem) {
    return res.status(400).json({ error: problem });
  }

  const data = memberToDb(req.body);
  const sets = data.columns.map(function (c) { return c + " = ?"; }).join(", ");

  try {
    const result = await db(
      "UPDATE members SET " + sets + " WHERE id = ?",
      data.values.concat([Number(req.params.id)])
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Member not found." });
    }
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: DUPLICATE_MEMBER });
    }
    throw err;
  }
}));

app.delete("/api/members/:id", route(async function (req, res) {
  const result = await db("DELETE FROM members WHERE id = ?", [Number(req.params.id)]);
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Member not found." });
  }
  res.json({ ok: true });
}));

// ---------- ASSOCIATIONS (with their executives) ----------

function associationProblem(body) {
  if (!text(body.name)) {
    return "The association needs a name.";
  }
  const executives = Array.isArray(body.executives) ? body.executives : [];
  for (let i = 0; i < executives.length; i++) {
    if (!text(executives[i].name) || !text(executives[i].phone)) {
      return "Every executive needs a name and a phone number.";
    }
  }
  return null;
}

async function saveExecutives(client, associationId, executives) {
  for (const e of executives) {
    await inTx(
      client,
      "INSERT INTO executives (association_id, name, title, phone, email) VALUES (?, ?, ?, ?, ?)",
      [associationId, text(e.name), text(e.title), text(e.phone), text(e.email)]
    );
  }
}

app.get("/api/associations", route(async function (req, res) {
  const associations = await db("SELECT * FROM associations ORDER BY id");
  const executives = await db("SELECT * FROM executives ORDER BY id");

  const list = associations.rows.map(function (a) {
    return {
      id: a.id,
      name: a.name,
      males: a.males,
      females: a.females,
      executives: executives.rows
        .filter(function (e) { return e.association_id === a.id; })
        .map(function (e) {
          return { name: e.name, title: e.title || "", phone: e.phone, email: e.email || "" };
        })
    };
  });

  res.json(list);
}));

app.post("/api/associations", route(async function (req, res) {
  const problem = associationProblem(req.body);
  if (problem) {
    return res.status(400).json({ error: problem });
  }

  const executives = Array.isArray(req.body.executives) ? req.body.executives : [];

  const id = await withTransaction(async function (client) {
    const result = await inTx(
      client,
      "INSERT INTO associations (name, males, females) VALUES (?, ?, ?) RETURNING id",
      [text(req.body.name), Number(req.body.males) || 0, Number(req.body.females) || 0]
    );
    const newId = result.rows[0].id;
    await saveExecutives(client, newId, executives);
    return newId;
  });

  res.status(201).json({ id: id });
}));

app.put("/api/associations/:id", route(async function (req, res) {
  const problem = associationProblem(req.body);
  if (problem) {
    return res.status(400).json({ error: problem });
  }

  const id = Number(req.params.id);
  const executives = Array.isArray(req.body.executives) ? req.body.executives : [];
  const newName = text(req.body.name);

  const found = await withTransaction(async function (client) {
    const old = await inTx(client, "SELECT name FROM associations WHERE id = ?", [id]);
    if (old.rows.length === 0) {
      return false;
    }

    await inTx(
      client,
      "UPDATE associations SET name = ?, males = ?, females = ? WHERE id = ?",
      [newName, Number(req.body.males) || 0, Number(req.body.females) || 0, id]
    );

    // Replace the executives with the ones that were sent
    await inTx(client, "DELETE FROM executives WHERE association_id = ?", [id]);
    await saveExecutives(client, id, executives);

    // If the association was renamed, keep its members attached to it
    if (old.rows[0].name !== newName) {
      await inTx(client, "UPDATE members SET association = ? WHERE association = ?", [newName, old.rows[0].name]);
    }
    return true;
  });

  if (!found) {
    return res.status(404).json({ error: "Association not found." });
  }
  res.json({ ok: true });
}));

app.delete("/api/associations/:id", route(async function (req, res) {
  // Its executives are deleted automatically
  const result = await db("DELETE FROM associations WHERE id = ?", [Number(req.params.id)]);
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Association not found." });
  }
  res.json({ ok: true });
}));

// ---------- OFFERINGS ----------

function offeringProblem(body) {
  if (!text(body.occasion) || !text(body.date) || text(body.amount) === null || isNaN(Number(body.amount))) {
    return "An offering needs an occasion, a date and an amount.";
  }
  return null;
}

app.get("/api/offerings", route(async function (req, res) {
  const result = await db("SELECT * FROM offerings ORDER BY offering_date, id");
  res.json(result.rows.map(function (r) {
    return { id: r.id, occasion: r.occasion, date: r.offering_date, amount: Number(r.amount) };
  }));
}));

app.post("/api/offerings", route(async function (req, res) {
  const problem = offeringProblem(req.body);
  if (problem) {
    return res.status(400).json({ error: problem });
  }

  const result = await db(
    "INSERT INTO offerings (occasion, offering_date, amount) VALUES (?, ?, ?) RETURNING id",
    [text(req.body.occasion), text(req.body.date), Number(req.body.amount)]
  );
  res.status(201).json({ id: result.rows[0].id });
}));

app.put("/api/offerings/:id", route(async function (req, res) {
  const problem = offeringProblem(req.body);
  if (problem) {
    return res.status(400).json({ error: problem });
  }

  const result = await db(
    "UPDATE offerings SET occasion = ?, offering_date = ?, amount = ? WHERE id = ?",
    [text(req.body.occasion), text(req.body.date), Number(req.body.amount), Number(req.params.id)]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Offering not found." });
  }
  res.json({ ok: true });
}));

app.delete("/api/offerings/:id", route(async function (req, res) {
  const result = await db("DELETE FROM offerings WHERE id = ?", [Number(req.params.id)]);
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Offering not found." });
  }
  res.json({ ok: true });
}));

// ---------- ERRORS ----------

app.use(function (req, res) {
  res.status(404).send("Page not found.");
});

app.use(function (err, req, res, next) {
  console.error(err);
  res.status(err.status || 500).json({ error: "Something went wrong on the server." });
});

// ---------- START ----------

// On Vercel the app is exported. On your own computer (node server.js) it listens on a port.
if (require.main === module) {
  app.listen(PORT, function () {
    console.log("Church System is running at http://localhost:" + PORT);
  });
}

module.exports = app;
