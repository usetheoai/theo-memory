/**
 * Caps provider calls per evaluated case. A single cap for the whole run made the last cases
 * fail once the pipeline needed a little more than two calls on average, so the score
 * depended on case order. A per-case cap still bounds cost and stops a runaway case.
 */
export class CallBudget {
  private caseCalls = 0;
  private spent = 0;

  constructor(private readonly perCase: number) {}

  startCase(): void {
    this.caseCalls = 0;
  }

  spend(): void {
    if (++this.caseCalls > this.perCase) throw new Error('Provider call budget exceeded for one case.');
    this.spent++;
  }

  get total(): number {
    return this.spent;
  }
}
