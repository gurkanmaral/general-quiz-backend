/**
 * Look-alike Groups (Hard difficulty): hand-curated sets of flags that are easy
 * to confuse. Every code is a UN member and appears in at most one group.
 */
export const LOOKALIKE_GROUPS: readonly (readonly string[])[] = [
  ['td', 'ro', 'ad', 'md'], // Chad, Romania, Andorra, Moldova
  ['id', 'mc', 'pl', 'sg'], // Indonesia, Monaco, Poland, Singapore
  ['ie', 'ci', 'it'], // Ireland, Côte d'Ivoire, Italy
  ['sk', 'si', 'ru', 'rs', 'hr'], // Slovakia, Slovenia, Russia, Serbia, Croatia
  ['nl', 'lu'], // Netherlands, Luxembourg
  ['au', 'nz'], // Australia, New Zealand
  ['ve', 'ec', 'co'], // Venezuela, Ecuador, Colombia
  ['ml', 'gn', 'sn', 'cm'], // Mali, Guinea, Senegal, Cameroon
  ['bo', 'gh', 'lt'], // Bolivia, Ghana, Lithuania
  ['dk', 'no', 'se', 'fi', 'is'], // Nordic crosses
  ['hn', 'ni', 'sv', 'gt'], // Honduras, Nicaragua, El Salvador, Guatemala
  ['sy', 'eg', 'ye', 'iq'], // Syria, Egypt, Yemen, Iraq
  ['jo', 'sd', 'ae', 'kw'], // Jordan, Sudan, UAE, Kuwait
  ['at', 'lv', 'pe'], // Austria, Latvia, Peru
  ['th', 'cr'], // Thailand, Costa Rica
  ['in', 'ne'], // India, Niger
  ['us', 'lr', 'my'], // USA, Liberia, Malaysia
  ['tr', 'tn'], // Türkiye, Tunisia
  ['cz', 'ph'], // Czechia, Philippines
  ['be', 'de'], // Belgium, Germany
  ['hu', 'bg', 'tj'], // Hungary, Bulgaria, Tajikistan
];

const GROUP_OF: ReadonlyMap<string, readonly string[]> = new Map(
  LOOKALIKE_GROUPS.flatMap((group) => group.map((code) => [code, group] as const)),
);

/** The Look-alike Group containing `code` (the code included), or undefined. */
export function groupOf(code: string): readonly string[] | undefined {
  return GROUP_OF.get(code.toLowerCase());
}
