import React from "react";
import { JSX } from "react";

interface PageProps {
  body: JSX.Element;
}

// The page's main landmark, with room at the sides on small screens.
export const Page = (props: PageProps): JSX.Element => {
  return <main className="w-full h-full px-4 py-6 sm:px-6 sm:py-8">{props.body}</main>;
};
