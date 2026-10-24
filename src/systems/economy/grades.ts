import { MATERIAL } from '../../shared/blocks';
import { DEBRIS } from './balance';

/**
 * The grades of heap: which material a heap of debris gives, by where it is drawn in the run's field,
 * and how many strips it has and what a strip yields at that grade. Scrap is the ordinary heap; the
 * better grades take one place in each dawn's batch from a batch on (`DEBRIS.grades`). Pure, so the
 * field generator, the host's economy and the tests share the table.
 */

/** A range of whole numbers, both ends included. */
export interface Span {
  readonly min: number;
  readonly max: number;
}

/**
 * The grade (a `MATERIAL` id) of the heap drawn `slot`th (counting from 0) of dawn batch `batch`
 * (0 is the batch that lies in the open from the start): Scrap, unless the table gives that place
 * to a better material.
 */
export function gradeAt(batch: number, slot: number): number {
  for (const grade of DEBRIS.grades) {
    if (batch >= grade.from && slot === grade.slot) return grade.material;
  }
  return MATERIAL.scrap;
}

/** How many strips a heap of this grade has, from the fewest to the most. */
export function harvestsOfGrade(material: number): Span {
  return DEBRIS.grades.find((grade) => grade.material === material)?.harvests ?? DEBRIS.harvests;
}

/** What one strip of a heap of this grade gives, from the least to the most. */
export function yieldOfGrade(material: number): Span {
  return DEBRIS.grades.find((grade) => grade.material === material)?.yield ?? DEBRIS.yield;
}
