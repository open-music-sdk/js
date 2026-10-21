"use client";
// Signed out, the listener picks the storefront. The server keeps the pick in
// a cookie, and draws the page again in it.
import { useTransition } from "react";
import { pickStorefront } from "@/lib/actions";
import { showError } from "./status";

interface tStorefrontPickerProps {
  /** The storefront the page is asked in. */
  readonly current: string;
  readonly storefronts: readonly { id: string; name: string }[];
}

export function StorefrontPicker(props: tStorefrontPickerProps) {
  const { current, storefronts } = props;
  const [picking, startPicking] = useTransition();
  const pick = (id: string) => {
    startPicking(async () => {
      await pickStorefront(id).catch(showError);
    });
  };
  return (
    <label id="storefront-picker">
      Storefront{" "}
      <select
        value={current}
        disabled={picking}
        onChange={(event) => {
          pick(event.target.value);
        }}
      >
        {storefronts.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
