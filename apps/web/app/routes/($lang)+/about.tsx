import type { MetaFunction } from '@remix-run/node';
import { Main } from '~/ui/main';

export const meta: MetaFunction = () => {
  return [
    { title: 'About Us | GYCC' },
    { name: 'description', content: 'Welcome to GYCC!' },
  ];
};

export default function Index() {
  return (
    <Main className="gap-10 px-3 py-12 text-2xl">
      <h1 className="text-5xl">About Us</h1>
      <p>
        GYC Canada (Generation Youth Christ) is a youth-initiated and led
        movement of Seventh-day Adventists from diverse, united in a common
        commitment to serious Bible study, intense prayer, uncompromising
        lifestyle, and boldness in sharing Christ with others.
      </p>
      <p>
        GYC Canada seeks to uphold the distinctive message of the Seventh-day
        Adventist Church and equip and inspire young Adventists to be Christian
        ambassadors to their respective places of work and study.
      </p>
      <p>
        GYC Canada is the Canadian affiliate of GYC. We are Canadian Seventh-day
        Adventist young people who seek to promote the spirit and ideals of GYC
        in Canada.
      </p>
      <p>
        GYC Canada is a recognized independent supporting ministry of the
        Seventh-day Adventist Church of Canada. GYC Canada supports the
        Seventh-day Adventist Church and encourages young people across Canada
        to be active members in their local churches.
      </p>
      <p className="text-lg font-bold">
        Disclaimer: GYC Canada does not accept tithes. We encourage donors to
        give tithes to their respective churches.
      </p>
      <div className="flex flex-col gap-4 italic">
        <p className="">
          “Let no one despise you for your youth, but set the believers an
          example in speech, in conduct, in love, in faith, in purity.”{' '}
          <span className="font-bold">1 Timothy 4:12</span>
        </p>
        <p>
          “With such an army of workers as our youth, rightly trained, might
          furnish, how soon the message of a crucified, risen, and soon-coming
          Saviour might be carried to the whole world!”{' '}
          <span className="font-bold">Education, p. 271.2</span>
        </p>
      </div>
    </Main>
  );
}
