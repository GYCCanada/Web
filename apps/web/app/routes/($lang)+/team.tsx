import type { MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { useTranslate } from '~/lib/localization/context';
import { TranslationKey } from '~/lib/localization/translations';
import { Main } from '~/ui/main';

export const meta: MetaFunction = () => {
  return [
    { title: 'The Team | GYCC' },
    { name: 'description', content: 'Welcome to GYCC!' },
  ];
};

type TeamMember = {
  name: string;
  position: Extract<TranslationKey, `team.position.${string}`>;
  image: string;
};

type BoardMembers = string[];

const team: TeamMember[] = [
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
    name: 'Lily Wheeler',
    position: 'team.position.secretary',
    image: '/team/lily.jpg',
  },
];
const board: BoardMembers = [
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
export const loader = () => {
  return {
    team,
    board,
  };
};

export default function Index() {
  const translate = useTranslate();
  const { team, board } = useLoaderData<typeof loader>();
  return (
    <Main>
      <div className="mx-auto flex h-[700px] w-full max-w-[1200px] flex-col p-4">
        <img
          src="/group-van-2022.jpg"
          className="absolute inset-0 h-full w-full object-cover"
          alt={translate('team.image.alt') as string}
        />
        <div className="flex items-center justify-center gap-6 text-neutral-950">
          <h1 className="shrink text-balance text-2xl sm:text-3xl md:text-4xl lg:text-5xl">
            {translate('team.title', {
              movement: (
                <span className="italic">
                  {translate('team.title.movement')}
                </span>
              ),
            })}
          </h1>
          <img
            className="block size-[140px] -rotate-90 object-contain"
            src="/logo/gycc-logo.png"
            alt={translate('team.image.alt') as string}
          />
        </div>
      </div>
      <div className="flex flex-col gap-8 px-4">
        <p>{translate('team.subtitle')}</p>

        <div className="grid grid-cols-2 gap-4 pb-20 sm:grid-cols-3  md:grid-cols-4 lg:grid-cols-5">
          {team.map((member) => (
            <div key={member.name} className="flex flex-col gap-1.5">
              <img
                src={member.image}
                alt={member.name}
                className="aspect-square w-full object-cover"
              />
              <h2 className="font-medium">{member.name}</h2>
              <p className="text-sm italic">{translate(member.position)}</p>
            </div>
          ))}
        </div>
        <hr />
        <div className="flex flex-col gap-7">
          <h3 className="text-xl font-bold">{translate('team.board')}</h3>
          <ul className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4">
            {board.map((name, index) => (
              <li key={index}>{name}</li>
            ))}
          </ul>
        </div>
      </div>
    </Main>
  );
}
