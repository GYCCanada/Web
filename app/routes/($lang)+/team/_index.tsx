import type { MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';

import { useTranslate } from '~/lib/localization/context';
import { getLocale } from '~/lib/localization/localization';
import { Main } from '~/ui/main';

import { board, team } from './team.server';

export const meta: MetaFunction = ({ params }) => {
  const lang = getLocale(params);
  if (lang === 'fr') {
    return [
      { title: "L'équipe | GYCC" },
      { name: 'description', content: "Rencontrez l'équipe derrière GYCC" },
    ];
  }
  return [
    { title: 'The Team | GYCC' },
    { name: 'description', content: 'Meet the team behind GYCC' },
  ];
};

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
    <Main className="gap-10">
      <div className="mx-auto flex h-[700px] w-[--width] flex-col md:h-[478px] md:pt-0">
        <img
          src="/team/group-van-2022.jpg"
          className="absolute inset-0 size-full object-cover md:object-top"
          alt={translate('team.image.alt') as string}
        />
        <div className="flex items-center justify-center gap-6 text-neutral-950 md:pt-8">
          <h1 className="flex-1 shrink text-balance text-2xl sm:text-3xl md:max-w-[30%] md:text-4xl lg:text-5xl">
            {translate('team.title', {
              movement: (
                <span className="italic">
                  {translate('team.title.movement')}
                </span>
              ),
            })}
          </h1>
          <img
            className="block size-[140px] object-contain"
            src="/logo/gycc.png"
            alt={translate('team.image.alt') as string}
          />
        </div>
      </div>
      <div className="flex flex-col gap-8 p-4">
        <p>{translate('team.subtitle')}</p>

        <div className="grid grid-cols-2 gap-4 pb-20 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {team.map((member) => (
            <div
              key={member.name}
              className="flex flex-col gap-1.5"
            >
              <img
                src={member.image}
                alt={member.name}
                className="aspect-square w-full object-cover object-top"
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
