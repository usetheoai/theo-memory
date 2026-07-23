/**
 * Domain ontologies (Roadmap Item 15) — typed per-domain vocabularies layered
 * over the LLM extraction pipeline.
 *
 * An `Ontology` is a FLAT typed vocabulary — allowed entity types + allowed
 * relation types for a domain (medical / legal / code / support, or custom). It
 * is NOT OWL/RDF and NOT a reasoner (ADR D1): it guides the extraction prompt
 * (the LLM is steered toward the domain vocabulary) and validates the LLM's
 * output (out-of-vocabulary entity types coerce to `OTHER`, observable). It
 * persists in the EXISTING `entities.type` + `entity_edges.relation` text
 * columns — NO new store, NO migration (ADR D3, the competitive attack on
 * poly-store ontology systems).
 *
 * Prior art (a domain-tuned category taxonomy injected into the extraction
 * prompt to constrain the LLM's output) is surveyed in the blueprint.
 *
 */
import { InvalidOntology } from './errors.js';

/** The coercion fallback type — every ontology MUST allow it (out-of-vocab → OTHER). */
export const ONTOLOGY_FALLBACK_TYPE = 'OTHER';

/** A typed domain vocabulary for entity + relation extraction. */
export interface Ontology {
  /** Domain name (a built-in key or a custom label). */
  readonly name: string;
  /** Allowed entity types. MUST include `OTHER` (the coercion fallback). */
  readonly entityTypes: readonly string[];
  /** Allowed relation (verb-phrase) types. */
  readonly relationTypes: readonly string[];
  /** Optional one-line domain hint injected into the extraction prompt. */
  readonly description?: string;
}

/**
 * M13 (ADR D1, #111) — the closed DEFAULT taxonomy applied when NO domain
 * ontology is configured. Mirrors the Phase 2 prompt menu (prompt.ts) so the
 * types the LLM already emits are honored instead of discarded; out-of-vocab
 * coerces to `OTHER` via the same `applyOntologyToEntities` (observable
 * `ontology_type_coerced` — never the silent fallback the mechanism labels had).
 */
export const DEFAULT_ENTITY_TAXONOMY: Ontology = {
  name: 'default',
  entityTypes: ['PERSON', 'ORG', 'PLACE', 'PRODUCT', 'CONCEPT', 'OTHER'],
  relationTypes: [],
};

/** The built-in ontology registry keys. */
export type OntologyName = 'medical' | 'legal' | 'code' | 'support';

/**
 * Built-in domain ontologies (blueprint Rec 2). Each carries a curated entity +
 * relation vocabulary; `OTHER` is always present as the coercion fallback. The
 * `code` ontology mirrors the coding-taxonomy shape surveyed in the blueprint.
 */
export const BUILTIN_ONTOLOGIES: Readonly<Record<OntologyName, Ontology>> = {
  medical: {
    name: 'medical',
    description: 'Clinical / medical domain: symptoms, diagnoses, medications, procedures, anatomy.',
    entityTypes: ['Symptom', 'Diagnosis', 'Medication', 'Procedure', 'Anatomy', 'Patient', 'Provider', ONTOLOGY_FALLBACK_TYPE],
    relationTypes: ['treats', 'causes', 'indicates', 'contraindicates', 'diagnosed_with', 'prescribed', 'located_in'],
  },
  legal: {
    name: 'legal',
    description: 'Legal domain: parties, contracts, clauses, statutes, courts, obligations.',
    entityTypes: ['Party', 'Contract', 'Clause', 'Statute', 'Court', 'Obligation', 'Jurisdiction', ONTOLOGY_FALLBACK_TYPE],
    relationTypes: ['binds', 'breaches', 'cites', 'governs', 'party_to', 'obligates', 'supersedes'],
  },
  code: {
    name: 'code',
    description: 'Software domain: modules, functions, classes, dependencies, bugs, decisions.',
    entityTypes: ['Module', 'Function', 'Class', 'Dependency', 'Bug', 'Decision', 'Test', ONTOLOGY_FALLBACK_TYPE],
    relationTypes: ['calls', 'imports', 'depends_on', 'fixes', 'tests', 'extends', 'implements'],
  },
  support: {
    name: 'support',
    description: 'Customer-support domain: customers, issues, products, resolutions, agents.',
    entityTypes: ['Customer', 'Issue', 'Product', 'Resolution', 'Agent', 'Feature', 'Account', ONTOLOGY_FALLBACK_TYPE],
    relationTypes: ['reports', 'affects', 'resolves', 'escalates', 'owns', 'requests', 'assigned_to'],
  },
};

function isBuiltinName(value: string): value is OntologyName {
  return Object.prototype.hasOwnProperty.call(BUILTIN_ONTOLOGIES, value);
}

/**
 * Validate a custom `Ontology`. Throws `InvalidOntology` when:
 *  - `name` is blank,
 *  - `entityTypes` is empty OR does not include `OTHER` (the coercion fallback),
 *  - `relationTypes` is empty.
 * Returns the ontology unchanged when valid.
 */
export function validateOntology(ontology: Ontology): Ontology {
  if (ontology.name.trim().length === 0) {
    throw new InvalidOntology('name must be non-empty');
  }
  if (ontology.entityTypes.length === 0) {
    throw new InvalidOntology(`ontology "${ontology.name}" must declare at least one entity type`);
  }
  if (!ontology.entityTypes.includes(ONTOLOGY_FALLBACK_TYPE)) {
    throw new InvalidOntology(
      `ontology "${ontology.name}" entityTypes must include the coercion fallback "${ONTOLOGY_FALLBACK_TYPE}"`,
    );
  }
  if (ontology.relationTypes.length === 0) {
    throw new InvalidOntology(`ontology "${ontology.name}" must declare at least one relation type`);
  }
  return ontology;
}

/**
 * Resolve an ontology config value to a concrete `Ontology`:
 *  - a built-in registry key (`'medical' | 'legal' | 'code' | 'support'`) → the built-in,
 *  - a custom `Ontology` object → validated + returned.
 * Throws `InvalidOntology` on an unknown string key or an invalid custom object.
 */
// `OntologyName | (string & {})` keeps editor autocomplete for the built-in keys
// while still accepting any string (resolved at runtime — unknown keys throw).
export function resolveOntology(value: Ontology | OntologyName | (string & {})): Ontology {
  if (typeof value === 'string') {
    if (isBuiltinName(value)) {
      return BUILTIN_ONTOLOGIES[value];
    }
    throw new InvalidOntology(
      `unknown built-in ontology "${value}" (expected one of: ${Object.keys(BUILTIN_ONTOLOGIES).join(', ')}, or a custom Ontology object)`,
    );
  }
  return validateOntology(value);
}
