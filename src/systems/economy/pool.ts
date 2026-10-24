import { POOL_SLOTS, poolSlot } from '../../shared/economy';

/**
 * The crew's shared pool of materials (SPEC section 9: one pool for all base construction and
 * upgrades; what a player carries personally is tools and temporary gear). A count of each
 * material, whole numbers, with one ceiling for all of them. Pure, so the host's rules and the
 * tests share it.
 */
export class Pool {
  private readonly stock = new Array<number>(POOL_SLOTS).fill(0);
  private limit: number;

  /** `start` gives the opening stock by material id; a material it leaves out starts at 0. */
  constructor(cap: number, start: Readonly<Record<number, number>> = {}) {
    this.limit = Math.max(0, Math.floor(cap));
    for (const [material, amount] of Object.entries(start)) {
      this.set(Number(material), amount);
    }
  }

  /** The most the pool holds of any one material. */
  get cap(): number {
    return this.limit;
  }

  /** Raises or lowers the ceiling. What the pool holds above a lowered ceiling stays, but nothing is added to it. */
  setCap(cap: number): void {
    if (Number.isFinite(cap)) this.limit = Math.max(0, Math.floor(cap));
  }

  /** How much of a material the pool holds; 0 for an id it does not keep. */
  amount(material: number): number {
    return this.stock[poolSlot(material)] ?? 0;
  }

  /** How much more of a material the pool has room for. */
  room(material: number): number {
    return Math.max(0, this.limit - this.amount(material));
  }

  /** True when the pool holds at least `amount` of a material. */
  has(material: number, amount: number): boolean {
    return this.amount(material) >= amount;
  }

  /** Adds up to `amount` of a material, as much as the ceiling allows, and returns what went in. */
  add(material: number, amount: number): number {
    const slot = poolSlot(material);
    if (slot < 0 || !(amount > 0)) return 0;
    const added = Math.min(Math.floor(amount), this.room(material));
    this.stock[slot] = (this.stock[slot] as number) + added;
    return added;
  }

  /** Takes `amount` of a material if the pool holds that much, and says whether it did. Nothing is taken otherwise. */
  take(material: number, amount: number): boolean {
    const slot = poolSlot(material);
    if (slot < 0 || !(amount >= 0)) return false;
    const whole = Math.ceil(amount);
    if ((this.stock[slot] as number) < whole) return false;
    this.stock[slot] = (this.stock[slot] as number) - whole;
    return true;
  }

  /** Sets a material's count outright, between 0 and the ceiling. For the opening stock, tests and the debug page. */
  set(material: number, amount: number): void {
    const slot = poolSlot(material);
    if (slot < 0 || !Number.isFinite(amount)) return;
    this.stock[slot] = Math.min(this.limit, Math.max(0, Math.floor(amount)));
  }

  /** Writes the counts into `out`, in `POOL_MATERIALS` order. */
  read(out: number[]): number[] {
    for (let i = 0; i < POOL_SLOTS; i++) out[i] = this.stock[i] as number;
    return out;
  }
}
