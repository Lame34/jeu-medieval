/** Validated game rules, loaded once from the JSON data files. */
import { validateCampaign } from '../core/campaign/validate.ts';
import { validateRules } from '../core/rules/validate.ts';
import { validateGlossary, type Glossary } from '../core/text/glossary.ts';
import type { CampaignData } from '../core/campaign/types.ts';
import type { GameRules } from '../core/rules/types.ts';
import campaign from './campaign.json' with { type: 'json' };
import damage from './damage.json' with { type: 'json' };
import glossary from './glossary.json' with { type: 'json' };
import heroes from './heroes.json' with { type: 'json' };
import terrain from './terrain.json' with { type: 'json' };
import units from './units.json' with { type: 'json' };

export const DEFAULT_RULES: GameRules = validateRules({ terrain, units, damage, heroes });

/** The campaign of the Val d’Orle (J6), checked against the rules. */
export const CAMPAIGN: CampaignData = validateCampaign(campaign, DEFAULT_RULES);

/** The words of the siege and their first attestation (ADR-046). */
export const GLOSSARY: Glossary = validateGlossary(glossary);
