import type { MetaFunction } from '@remix-run/node';
import { Main } from '~/ui/main';

export const meta: MetaFunction = () => {
  return [
    { title: 'About Us | GYCC' },
    { name: 'description', content: 'Welcome to GYCC!' },
  ];
};

export default function Index() {
  return <Main className="gap-10 px-3 py-12">About Us</Main>;
}
