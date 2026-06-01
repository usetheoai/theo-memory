#!/usr/bin/env node
/**
 * Deterministic generator for the 150 PROCEDURAL fixtures in
 * `tests/fixtures/distillation/` (40 single-fact + 40 multi-fact + 15
 * contradiction-pair + 15 entity-overlap + 40 simulated-dialog). The 50
 * HAND-AUTHORED fixtures (10 per category, committed verbatim) carry
 * `source: "hand"` and are exempt from this generator.
 *
 * Procedural fixtures use a seeded LCG to pick template slots so the
 * generator is fully reproducible (`make` semantics — re-running produces
 * byte-identical files). Test SHA is committed; future v0.7.1 cycle can
 * replace procedural with hand or LLM-simulated-and-verified per plan
 * ADR D4 without breaking the loader contract.
 *
 * Usage:
 *   node scripts/generate-distillation-fixtures.mjs
 *
 * @see .claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md § T3.1 + ADR D4
 */
import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', 'tests', 'fixtures', 'distillation');

// Seeded LCG for reproducibility (Numerical Recipes parameters).
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const TOPICS = [
  { entity: 'project Halcyon', verb: 'launches', when: 'in Q4', detail: '500 enterprise pilots' },
  { entity: 'Olivia from finance', verb: 'reviews', when: 'every Friday', detail: 'the quarterly burn rate' },
  { entity: 'the staging cluster', verb: 'auto-scales', when: 'overnight', detail: 'between 4 and 12 nodes' },
  { entity: 'the analytics dashboard', verb: 'refreshes', when: 'every 15 minutes', detail: 'against a read replica' },
  { entity: 'Theo from support', verb: 'rotates', when: 'weekly', detail: 'through the on-call schedule' },
  { entity: 'the API gateway', verb: 'rate-limits', when: 'per IP', detail: 'at 1000 requests per minute' },
  { entity: 'the build pipeline', verb: 'runs', when: 'on every PR', detail: 'across 8 parallel runners' },
  { entity: 'Yuki from research', verb: 'publishes', when: 'monthly', detail: 'the model evaluation report' },
  { entity: 'the postgres replica', verb: 'lags', when: 'during peak', detail: 'by 200 to 400 milliseconds' },
  { entity: 'the auth service', verb: 'rotates', when: 'every 90 days', detail: 'JWT signing keys' },
];

const CITIES = ['Berlin', 'Toronto', 'Tokyo', 'Auckland', 'Stockholm', 'Lagos', 'Rio', 'Vienna', 'Montréal', 'Helsinki'];

function pad2(n) { return String(n).padStart(2, '0'); }

function writeIfMissing(category, idx, fixture) {
  const filename = `${pad2(idx)}-proc-${fixture.id.split('-').slice(2).join('-')}.json`;
  const path = resolve(ROOT, category, filename);
  if (existsSync(path)) {
    // Idempotent: re-running is a no-op for already-generated files.
    return path;
  }
  writeFileSync(path, JSON.stringify(fixture, null, 2) + '\n');
  return path;
}

let generated = 0;

// 40 procedural single-fact (indices 11..50)
{
  const rng = makeRng(0x53_49_4E_47); // 'SING'
  for (let i = 11; i <= 50; i++) {
    const topic = TOPICS[Math.floor(rng() * TOPICS.length)];
    const city = CITIES[Math.floor(rng() * CITIES.length)];
    const episodeText = `For the ${city} deployment, ${topic.entity} ${topic.verb} ${topic.when} — ${topic.detail}.`;
    writeIfMissing('single-fact', i, {
      id: `single-fact-${pad2(i)}-proc-${topic.entity.replace(/\s+/g, '-')}-${city.toLowerCase()}`,
      category: 'single-fact',
      source: 'procedural-seed',
      episodeText,
      expectedFacts: [
        { text: `${topic.entity} ${topic.verb} ${topic.when} (${city} deployment)` },
      ],
    });
    generated++;
  }
}

// 40 procedural multi-fact (indices 11..50): combine 3 unrelated topics per episode
{
  const rng = makeRng(0x4D_55_4C_54); // 'MULT'
  for (let i = 11; i <= 50; i++) {
    const t1 = TOPICS[Math.floor(rng() * TOPICS.length)];
    const t2 = TOPICS[Math.floor(rng() * TOPICS.length)];
    const t3 = TOPICS[Math.floor(rng() * TOPICS.length)];
    const city = CITIES[Math.floor(rng() * CITIES.length)];
    const episodeText = `In the ${city} region: ${t1.entity} ${t1.verb} ${t1.when}; ${t2.entity} ${t2.verb} ${t2.when} (${t2.detail}); ${t3.entity} ${t3.verb} ${t3.when}.`;
    writeIfMissing('multi-fact', i, {
      id: `multi-fact-${pad2(i)}-proc-${city.toLowerCase()}-${i}`,
      category: 'multi-fact',
      source: 'procedural-seed',
      episodeText,
      expectedFacts: [
        { text: `${t1.entity} ${t1.verb} ${t1.when}` },
        { text: `${t2.entity} ${t2.verb} ${t2.when} — ${t2.detail}` },
        { text: `${t3.entity} ${t3.verb} ${t3.when}` },
      ],
    });
    generated++;
  }
}

// 15 procedural contradiction-pair (indices 11..25): kept = new value, rejected = a known prior
{
  const rng = makeRng(0x43_4F_4E_46); // 'CONF'
  const PRIORS = [
    'project Halcyon launches in Q4 — 500 enterprise pilots',
    'Olivia from finance reviews every Friday',
    'the staging cluster auto-scales overnight',
    'Yuki from research publishes monthly',
    'the auth service rotates every 90 days JWT signing keys',
  ];
  const NEW = [
    'project Halcyon launch postponed to Q1 of next year',
    'Olivia rotated to product; Marcus now owns the Friday review',
    'staging cluster fixed at 6 nodes after cost review',
    'Yuki paused monthly publication; switching to quarterly',
    'auth service moved to 30-day JWT rotation post-incident',
  ];
  for (let i = 11; i <= 25; i++) {
    const slot = Math.floor(rng() * PRIORS.length);
    const newFact = NEW[slot];
    const priorFact = PRIORS[slot];
    writeIfMissing('contradiction-pair', i, {
      id: `contradiction-pair-${pad2(i)}-proc-${slot}-${i}`,
      category: 'contradiction-pair',
      source: 'procedural-seed',
      episodeText: `Update: ${newFact}. (Previously: ${priorFact}.)`,
      expectedFacts: [{ text: newFact }],
      expectedConflictPair: { kept: newFact, rejected: priorFact },
    });
    generated++;
  }
}

// 15 procedural entity-overlap (indices 11..25): two facts about the SAME entity
{
  const rng = makeRng(0x45_4E_54_4F); // 'ENTO'
  const PERSONS = ['Priya', 'Aditya', 'Helena', 'Theo', 'Yuki', 'Bruno', 'Lin', 'Carlos', 'Eva', 'Marcus'];
  const ROLES = ['runs the SRE team', 'mentors juniors', 'owns the billing service', 'speaks at conferences', 'reviews architecture decisions'];
  const SKILLS = ['Rust + Postgres', 'observability', 'distributed systems', 'security audits', 'developer ergonomics'];
  for (let i = 11; i <= 25; i++) {
    const person = PERSONS[Math.floor(rng() * PERSONS.length)];
    const role = ROLES[Math.floor(rng() * ROLES.length)];
    const skill = SKILLS[Math.floor(rng() * SKILLS.length)];
    writeIfMissing('entity-overlap', i, {
      id: `entity-overlap-${pad2(i)}-proc-${person.toLowerCase()}-${i}`,
      category: 'entity-overlap',
      source: 'procedural-seed',
      episodeText: `${person} ${role} — also a deep expert in ${skill}.`,
      expectedFacts: [
        { text: `${person} ${role}` },
        { text: `${person} is a deep expert in ${skill}` },
      ],
    });
    generated++;
  }
}

// 40 procedural simulated-dialog (indices 11..50)
{
  const rng = makeRng(0x44_49_41_4C); // 'DIAL'
  const NEEDS = [
    'set up a monitoring dashboard for the new service',
    'plan a code review process for the team',
    'draft the Q3 OKRs',
    'schedule the offsite for the platform team',
    'evaluate a vendor proposal',
  ];
  const FACTS = [
    'the team has 6 engineers and 1 EM',
    'the budget cap is 50k USD',
    'the deadline is end of Q3',
    'the stack is TypeScript + Node + Postgres',
    'on-call covers business hours only',
  ];
  for (let i = 11; i <= 50; i++) {
    const need = NEEDS[Math.floor(rng() * NEEDS.length)];
    const f1 = FACTS[Math.floor(rng() * FACTS.length)];
    const f2 = FACTS[Math.floor(rng() * FACTS.length)];
    writeIfMissing('simulated-dialog', i, {
      id: `simulated-dialog-${pad2(i)}-proc-${i}`,
      category: 'simulated-dialog',
      source: 'procedural-seed',
      episodeText: `USER: I need to ${need}.\nAGENT: Got it — what context should I keep in mind?\nUSER: A few things: ${f1}; and ${f2}.\nAGENT: Noted. Let's start with the highest-priority item.`,
      expectedFacts: [
        { text: `Working on: ${need}` },
        { text: f1 },
        { text: f2 },
      ],
    });
    generated++;
  }
}

console.log(`generated ${generated} procedural fixtures (idempotent — pre-existing files preserved)`);
