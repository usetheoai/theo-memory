/**
 * EC-3 typed error thrown by CostTracker when the requested model is not
 * present in pricing-table.json. Runner catches and persists
 * `pricing_table_miss: true, cost: NaN, model_attempted: <name>` for
 * downstream `docs/benchmarks/v0.8.md` to surface honestly as
 * "cost N/A — see notes".
 *
 * @see plan v1.2 § T4.1 + EC-3
 */
export class PricingTableMiss extends Error {
  readonly modelName: string;

  constructor(modelName: string) {
    super(`pricing-table.json does not contain rates for model "${modelName}"`);
    this.name = 'PricingTableMiss';
    this.modelName = modelName;
    Object.setPrototypeOf(this, PricingTableMiss.prototype);
  }
}
