/** Validated game rules, loaded once from the JSON data files. */
import { validateRules } from '../core/rules/validate.ts';
import type { GameRules } from '../core/rules/types.ts';
import damage from './damage.json' with { type: 'json' };
import terrain from './terrain.json' with { type: 'json' };
import units from './units.json' with { type: 'json' };

export const DEFAULT_RULES: GameRules = validateRules({ terrain, units, damage });
