// Where a share may go, and which organization is "Recommended" (issue #362,
// D84 point 3). The rule is a pure function over counts, so the unit test
// covers every count case the journey cannot; `organizationChoices` gathers
// the counts through the Door43 adapter.
import type { Door43Api, Door43Session } from './door43Api';

export interface OrganizationChoice {
  /** The organization's account name. */
  organization: string;
  fullName: string;
  /** False: shown, cannot be chosen, with the reason (D84 point 3). */
  canCreateRepository: boolean;
  /** Repositories the organization has in the project's language. */
  repositoriesInLanguage: number;
  recommended: boolean;
}

/** The one organization to mark, or null. Of the organizations the user can
 * choose, the one with the most repositories in the project's language; none
 * when no such repository exists or two or more share the highest count. */
export function recommendOrganization(
  choices: ReadonlyArray<
    Pick<OrganizationChoice, 'organization' | 'canCreateRepository' | 'repositoriesInLanguage'>
  >,
): string | null {
  let best: string | null = null;
  let bestCount = 0;
  let tied = false;
  for (const choice of choices) {
    if (!choice.canCreateRepository) continue;
    if (choice.repositoriesInLanguage > bestCount) {
      best = choice.organization;
      bestCount = choice.repositoriesInLanguage;
      tied = false;
    } else if (choice.repositoriesInLanguage === bestCount && bestCount > 0) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/** The user's organizations with the permission and the count each, and the
 * recommendation applied. The order is Door43's. */
export async function organizationChoices(
  api: Door43Api,
  session: Door43Session,
  languageTag: string,
): Promise<OrganizationChoice[]> {
  const organizations = await api.listOrganizations(session);
  const choices: OrganizationChoice[] = [];
  for (const org of organizations) {
    const canCreateRepository = await api.canCreateRepository(session, org.username);
    const repositoriesInLanguage = await api.countRepositories(session, org.username, languageTag);
    choices.push({
      organization: org.username,
      fullName: org.fullName,
      canCreateRepository,
      repositoriesInLanguage,
      recommended: false,
    });
  }
  const recommended = recommendOrganization(choices);
  for (const choice of choices) choice.recommended = choice.organization === recommended;
  return choices;
}
