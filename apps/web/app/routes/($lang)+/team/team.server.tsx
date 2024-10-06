import type { TranslationKey } from '~/lib/localization/translations';

type TeamMember = {
  name: string;
  position: Extract<TranslationKey, `team.position.${string}`>;
  image: string;
};

type BoardMembers = string[];

export const team: TeamMember[] = [
  {
    name: 'Elijah Duffy',
    position: 'team.position.president',
    image: '/team/elijah.jpg',
  },
  {
    name: 'Sebastian Elias',
    position: 'team.position.vice-president',
    image: '/team/sebastian.jpg',
  },
  {
    name: 'Lillian Wheeler',
    position: 'team.position.secretary',
    image: '/team/lillian.jpg',
  },
];

export const board: BoardMembers = [
  'Virginia Polihronova',
  'George Cho',
  'Dominique Wheeler',
  'Daniel Cho',
  'Craig Cleveland',
  'Rudy Harnisch',
  'Abubacar',
];
