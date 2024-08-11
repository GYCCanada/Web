import type { TranslationKey } from '~/lib/localization/translations';

type TeamMember = {
  name: string;
  position: Extract<TranslationKey, `team.position.${string}`>;
  image: string;
};

type BoardMembers = string[];
export const team: TeamMember[] = [
  {
    name: 'Virginia Polihronova',
    position: 'team.position.president',
    image: '/team/virginia.jpg',
  },
  {
    name: 'Elijah Duffy',
    position: 'team.position.vice-president',
    image: '/team/elijah.jpg',
  },
  {
    name: 'Nahi Kim',
    position: 'team.position.vp-logistics',
    image: '/team/nahi.jpg',
  },
  {
    name: 'Sebastian Elias',
    position: 'team.position.vp-communications',
    image: '/team/sebastian.jpg',
  },
  {
    name: 'Eunice Schendel',
    position: 'team.position.vp-networking',
    image: '/team/eunice.jpg',
  },
  {
    name: 'Dita Gasperz',
    position: 'team.position.vp-missions',
    image: '/team/dita.jpg',
  },
  {
    name: 'Lillian Wheeler',
    position: 'team.position.secretary',
    image: '/team/lillian.jpg',
  },
];
export const board: BoardMembers = [
  'George Cho',
  'Daniel Cho',
  'Michael Dunbar',
  'Pekka Maattanen',
  'Edwin Chung',
  'Alain Mugisha',
  'Thando Amankwah',
  'Cedric Dassigli',
  'Jonathan Zita',
  'Valmy Karema',
  'Dominique Wheeler',
];
