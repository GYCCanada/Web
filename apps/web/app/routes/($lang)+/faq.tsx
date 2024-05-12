import { MetaFunction } from '@remix-run/react';
import { ExternalLink } from '~/ui/external-link';
import { Main } from '~/ui/main';

export const meta: MetaFunction = () => {
  return [
    { title: 'FAQ | GYCC' },
    { name: 'description', content: 'Frequently Asked Questions' },
  ];
};

export default function FaqPage() {
  return (
    <Main className="gap-10 px-3 py-12 text-2xl">
      <h1 className="text-5xl">Frequently Asked Questions</h1>

      <QuestionLayout>
        <Question>Exhibitor Booths</Question>
        <Answer>
          GYC Canada reserves the right to refuse any exhibitor that does not
          uphold the Spirit of GYC as documented in the About Us section of our
          website. Email us with any questions at{' '}
          <ExternalLink href="mailto:hello@gyccanada.org">
            hello@gyccanada.org
          </ExternalLink>
          .
          <br />
          <br /> A single-table exhibitor booth can be purchased for $30, and a
          two-table exhibitor booth for $40. An exhibitor booth does not include
          registration(s) for the person(s) running the booth. The Exhibit
          manager(s) must first register as attendees for the full conference.
          <br />
          <br />
          <span className="font-bold">BEFORE</span> registering, please email{' '}
          <ExternalLink href="mailto:hello@gyccanada.org">
            hello@gyccanada.org
          </ExternalLink>{' '}
          to get approval for your booth. This can avoid issues with your booth,
          and can help avoid refund issues if we decide you’re not a fit for our
          conference. GYC Canada reserves the right to refuse any exhibitor that
          does not uphold the Spirit of GYC as documented in the About Us
          section of our website.
        </Answer>
      </QuestionLayout>

      <QuestionLayout>
        <Question>Cancellation and Refunds</Question>
        <Answer>
          Conference registration fees are strictly NOT refundable*. You may
          transfer your registration to another person as long as they qualify
          for the same type of registration. You will notify GYC Canada of this
          change by emailing us at{' '}
          <ExternalLink href="mailto:hello@gyccanada.org">
            hello@gyccanada.org
          </ExternalLink>
          .
          <br />
          <br />
          <span className="italic">
            * The ONLY exception is government imposed restrictions that may
            inhibit in-person events
          </span>
        </Answer>
      </QuestionLayout>

      <QuestionLayout>
        <Question>Letter of Invitation</Question>
        <Answer>
          GYC Canada does not and will not provide you with a letter of
          invitation for any purpose. Everyone is welcome to attend our
          conference, but you as an attendee are fully responsible for ensuring
          you can attend and arranging your transport. We will have livestreams
          available for those who are not able to attend in person or would like
          to go back and review what was covered. Livestreams DO NOT cover
          Workshops or Breakouts, they are only available for those who attend
          in person. Livestreams will be available via our YouTube, Facebook and
          Website (
          <ExternalLink href="gyccanada.org">gyccanada.org</ExternalLink>) If
          you purchase a ticket and need an invitation, you are not viable for a
          refund. <br /> <br />
          <span className="font-bold">All ticket sales are final.</span>
        </Answer>
      </QuestionLayout>
    </Main>
  );
}

function QuestionLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>;
}

function Question({ children }: { children: React.ReactNode }) {
  return <p className="flex flex-col gap-4 text-4xl italic">{children}</p>;
}

function Answer({ children }: { children: React.ReactNode }) {
  return <p className="">{children}</p>;
}
