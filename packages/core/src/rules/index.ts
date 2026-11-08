import { accountRules } from './account';
import { financeRules } from './finance';
import { identityRules } from './identity';
import { impersonationRules } from './impersonation';
import { investmentRules } from './investment';
import { isolationRules } from './isolation';
import { jobTermsRules } from './jobTerms';
import { pressureRules } from './pressure';
import type { Rule } from './rule';
import { technicalRules } from './technical';

export const ALL_RULES: Rule[] = [
  ...financeRules,
  ...accountRules,
  ...identityRules,
  ...jobTermsRules,
  ...pressureRules,
  ...isolationRules,
  ...impersonationRules,
  ...investmentRules,
  ...technicalRules,
];

export { GROUP_WINDOW, groupsSatisfied, matchGroups, matchRule } from './rule';
export type { Rule } from './rule';
