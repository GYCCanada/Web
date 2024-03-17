import type { MetaFunction } from '@remix-run/node';

export const meta: MetaFunction = () => {
  return [
    { title: 'Volunteer | GYCC' },
    { name: 'description', content: 'Welcome to GYCC!' },
  ];
};

export default function Index() {
  return <div className="flex flex-1 flex-col"></div>;
}
