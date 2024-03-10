import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { getTranslation } from '~/lib/localization/localization.server';
import { LocalizationProvider } from '~/lib/localization/provider';
import { root } from '~/lib/localization/translations';
import { Button } from '~/ui/button';
import { Input } from '~/ui/input';
import { Label } from '~/ui/label';
import { Radio, RadioGroup, Radios } from '~/ui/radio';
import { TextField } from '~/ui/text-field';

export const meta: MetaFunction = () => {
  return [
    { title: 'New Remix App' },
    { name: 'description', content: 'Welcome to Remix!' },
  ];
};

export const loader = ({ params }: LoaderFunctionArgs) => {
  const translation = getTranslation(params, root);
  return { translation };
};

export function Layout({ children }: { children: React.ReactNode }) {
  const { translation } = useLoaderData<typeof loader>();
  return (
    <LocalizationProvider translation={translation}>
      {children}
    </LocalizationProvider>
  );
}

export default function Index() {
  return (
    <div>
      <div className="flex">
        <Button>Test</Button>
        <Button variant="negative">Test</Button>
        <div className="bg-neutral-900 p-1">
          <Button variant="positive">Test</Button>
        </div>
      </div>
      <div>
        <Input variant="negative" />
        <Input variant="negative" placeholder="text here" />
        <div className="flex flex-col bg-neutral-900 p-1">
          <Input variant="positive" />
          <Input variant="positive" placeholder="text here" />
        </div>
      </div>

      <div className="flex flex-col">
        <div className="flex flex-col bg-neutral-900 p-1">
          <TextField variant="positive">
            <Label>Test</Label>
            <Input placeholder="text here" />
          </TextField>
        </div>
      </div>
      <RadioGroup defaultValue="yes">
        <Label>Test</Label>
        <Radios>
          <Radio value="yes">Yes</Radio>
          <Radio value="no">No</Radio>
          <Radio value="maybe">Maybe</Radio>
        </Radios>
      </RadioGroup>
    </div>
  );
}
