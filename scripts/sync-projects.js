#!/usr/bin/env node
/**
 * npm run sync-projects
 *
 * Fetches all projects from the Vercel API and merges them into
 * data/projects.json, preserving hand-edited fields (description,
 * featured, hidden, stack, repo) for projects that already exist.
 *
 * Requires VERCEL_TOKEN in .env.local (never committed).
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

// --- load .env.local ---
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .forEach((line) => {
      const [k, ...v] = line.split("=");
      if (k && v.length) process.env[k.trim()] = v.join("=").trim();
    });
}

const TOKEN = process.env.VERCEL_TOKEN;
if (!TOKEN) {
  console.error("ERROR: VERCEL_TOKEN not set. Add it to .env.local");
  process.exit(1);
}

const DATA_PATH = path.join(__dirname, "..", "data", "projects.json");

function get(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          reject(new Error("Bad JSON: " + raw.slice(0, 200)));
        }
      });
    }).on("error", reject);
  });
}

async function fetchAllProjects(teamId) {
  const projects = [];
  let until = "";
  const base = teamId
    ? `https://api.vercel.com/v9/projects?limit=100&teamId=${teamId}`
    : "https://api.vercel.com/v9/projects?limit=100";

  while (true) {
    const url = until ? `${base}&until=${until}` : base;
    const { status, body } = await get(url, {
      Authorization: `Bearer ${TOKEN}`,
    });

    if (status !== 200) {
      console.warn(`  API returned ${status}:`, JSON.stringify(body));
      break;
    }

    projects.push(...(body.projects || []));

    if (body.pagination?.next) {
      until = body.pagination.next;
    } else {
      break;
    }
  }
  return projects;
}

async function main() {
  console.log("Fetching Vercel projects…");

  // Try personal account first
  let raw = await fetchAllProjects();
  console.log(`  Personal account: ${raw.length} project(s)`);

  // Team slug for wardopon123-9177 (set VERCEL_TEAM_ID to override)
  const teamId = process.env.VERCEL_TEAM_ID || "wardopon123-9177s-projects";
  const teamProjects = await fetchAllProjects(teamId);
  console.log(`  Team (${teamId}): ${teamProjects.length} project(s)`);
  // Merge, deduplicate by id
  const seen = new Set(raw.map((p) => p.id));
  teamProjects.forEach((p) => { if (!seen.has(p.id)) raw.push(p); });

  if (raw.length === 0) {
    console.warn(
      "  No projects returned. Check that VERCEL_TOKEN belongs to the account\n" +
        "  where your projects are deployed. If they are under a team, also set\n" +
        "  VERCEL_TEAM_ID=<team_id> in .env.local."
    );
  }

  // Load existing hand-edited data so we can preserve it
  const existing = fs.existsSync(DATA_PATH)
    ? JSON.parse(fs.readFileSync(DATA_PATH, "utf8"))
    : [];
  const byId = Object.fromEntries(existing.map((p) => [p.id, p]));

  const merged = raw.map((p) => {
    const prev = byId[p.id] || {};
    return {
      id: p.id,
      name: p.name,
      slug: p.name, // Vercel project name is URL-safe
      description: prev.description || p.name,
      url: prev.url || `https://${p.name}.vercel.app`,
      repo: prev.repo || "",
      framework: p.framework || "HTML/CSS/JS",
      stack: prev.stack || [],
      featured: prev.featured ?? false,
      hidden: prev.hidden ?? false,
      updatedAt: new Date(p.updatedAt).toISOString(),
    };
  });

  // Keep any hand-crafted entries that Vercel didn't return
  const apiIds = new Set(raw.map((p) => p.id));
  existing.forEach((p) => {
    if (!apiIds.has(p.id)) merged.push(p);
  });

  // Featured first, then alphabetical
  merged.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || a.name.localeCompare(b.name));

  fs.writeFileSync(DATA_PATH, JSON.stringify(merged, null, 2));
  console.log(`Done. Wrote ${merged.length} project(s) to data/projects.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
