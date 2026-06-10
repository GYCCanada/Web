import type { MetaFunction } from 'react-router';

export const meta: MetaFunction = () => {
  return [
    { title: 'GYCC' },
    { name: 'description', content: 'Welcome to GYCC!' },
  ];
};

export default function Index() {
  return <div className="flex flex-1 flex-col"></div>;
}
