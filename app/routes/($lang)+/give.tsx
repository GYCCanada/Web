import { type MetaFunction, useLoaderData } from "react-router";

import { getEnabledPageOr404 } from "~/lib/content/page-guard.server";
import { ReactRouterContext } from "~/lib/effect/router-context";
import { routeHandler } from "~/lib/effect/route";
import { useTranslate } from "~/lib/localization/context";
import { getLocale } from "~/lib/localization/localization";
import { toGiveView } from "~/lib/content/pages/project";
import { buttonStyle } from "~/ui/button";
import { Main } from "~/ui/main";

export const meta: MetaFunction = ({ params }) => {
  const locale = getLocale(params);
  if (locale === "fr") {
    return [
      { title: "Donner | GYCC" },
      { name: "description", content: "Soutenez le mouvement GYC Canada." },
    ];
  }
  return [
    { title: "Give | GYCC" },
    { name: "description", content: "Support the GYC Canada movement." },
  ];
};

export const loader = routeHandler(function* () {
  const { params } = yield* ReactRouterContext;
  const locale = getLocale(params);
  // 404 when the page is disabled (Feature C); else project the decoded page.
  return { page: toGiveView(yield* getEnabledPageOr404("give"), locale) };
});

export default function Index() {
  const translate = useTranslate();
  const { page } = useLoaderData<typeof loader>();
  return (
    <Main className="gap-10 px-3 py-12 text-2xl md:gap-16 md:px-16">
      <div className="flex flex-col gap-4 md:gap-16">
        <h1 className="text-5xl">{page.title}</h1>
        <p>{page.reason}</p>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-3xl">{translate("give.directions")}</h2>
        <ol className="list-inside list-decimal">
          {page.directions.map((direction) => (
            <li key={direction.id}>{direction.text}</li>
          ))}
        </ol>
      </div>
      <div>
        <a className={buttonStyle} href={page.donateUrl}>
          {translate("give.continue")}
        </a>
      </div>
    </Main>
  );
}
