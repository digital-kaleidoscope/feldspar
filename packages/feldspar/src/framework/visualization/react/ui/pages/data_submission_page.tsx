import React, { JSX, useCallback, useEffect, useRef } from "react";
import { Weak } from "../../../../helpers";
import TextBundle from "../../../../text_bundle";
import { Translator } from "../../../../translator";
import { Translatable } from "../../../../types/elements";
import { PropsUIPageDataSubmission } from "../../../../types/pages";
import { isPropsUIPromptConsentFormTable } from "../../../../types/prompts";
import { ReactFactoryContext } from "../../factory";
import { Page } from "./templates/page";
import { createPromptFactoriesWithDefaults, PromptContext } from "../prompts/factory";

type Props = Weak<PropsUIPageDataSubmission> & ReactFactoryContext;

export const DataSubmissionPage = (props: Props): JSX.Element => {
  const { title } = prepareCopy(props);
  const { locale } = props;
  const promptFactories = createPromptFactoriesWithDefaults(
    props.promptFactories
  );
  const DataSubmissionData = React.useRef<Map<string, string>>(new Map());

  // When the step changes (choosing a file, progress, the consent page...), focus moves to the heading so
  // screen readers announce the new page. Progress updates within a step keep the same kinds of items
  // and don't move focus.
  const heading = useRef<HTMLHeadingElement>(null);
  const bodyItems = Array.isArray(props.body) ? props.body : [props.body];
  const step = bodyItems.map((item: any) => item?.__type__).join(",");
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const onDataSubmissionDataChanged = useCallback((key: string, value: any)=> {
    DataSubmissionData.current.set(key, value);
  }, [DataSubmissionData]);

  function onDonate(): void {
    const DataSubmissionDataObject = Object.fromEntries(DataSubmissionData.current);
    props.resolve?.({ __type__: "PayloadJSON", value: JSON.stringify(DataSubmissionDataObject) });
  }

  function onCancel(): void {
    console.log("onCancel");
    props.resolve?.({
      __type__: "PayloadFalse",
      value: false
    });
  }

  function renderBodyItem(bodyItem: any, context: PromptContext): JSX.Element | null {
    for (const factory of promptFactories) {
      const element = factory.create(bodyItem, context);
      if (element !== null) {
        return element;
      }
    }
    return null;
  }

  function renderBody(props: Props): JSX.Element[] {
    const context = { locale: locale, resolve: props.resolve, onDataSubmissionDataChanged, onDonate, onCancel};
    const bodyItems = Array.isArray(props.body) ? props.body : [props.body];
    const tableCount = bodyItems.reduce(
      (count, item) => count + (isPropsUIPromptConsentFormTable(item) ? 1 : 0),
      0
    );
    let tableNumber = 0;

    return bodyItems.map((item, index) => {
      const itemContext = tableCount > 1 && isPropsUIPromptConsentFormTable(item)
        ? { ...context, consentTableNumber: ++tableNumber }
        : context;
      const element = renderBodyItem(item, itemContext);
      if (element === null) {
        throw new TypeError(`No factory found for body item at index ${index}`);
      }
      return <React.Fragment key={index}>{element}</React.Fragment>;
    });
  }

  const body: JSX.Element = (
    <>
      <h1 ref={heading} tabIndex={-1} className="text-title3 font-title3 sm:text-title2 lg:text-title1 lg:font-title1 text-grey1 mb-6 md:mb-8 focus:outline-none">
        {title}
      </h1>
      {renderBody(props)}
    </>
  );

  return <Page body={body} />;
};

interface Copy {
  title: string;
}

function prepareCopy({ header: { title }, locale }: Props): Copy {
  return {
    title: Translator.translate(title, locale),
  };
}
