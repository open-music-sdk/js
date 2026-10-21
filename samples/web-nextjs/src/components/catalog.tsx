"use client";
// A crate of records the server drew, each opening its page. Nothing here asks
// Apple: the next sleeves, where there are more, come from a server action.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { tSleeveData } from "@/lib/sleeves";
import type { tAnswer } from "@/lib/actions";
import { Crate } from "./box";
import type { tSleeve } from "./sleeve";
import { say, showError } from "./status";

interface tLinkCrateProps {
  readonly label: string;
  readonly sleeves: readonly tSleeveData[];
  readonly empty?: string | undefined;
  /**
   * The next sleeves after the first `offset`, from the server; none when
   * the crate holds all there are.
   */
  readonly more?: ((offset: number) => Promise<tAnswer<tSleeveData[]>>)
    | undefined;
}

export function LinkCrate({ label, sleeves, empty, more }: tLinkCrateProps) {
  const router = useRouter();
  const [added, setAdded] = useState<readonly tSleeveData[]>([]);
  const [looking, setLooking] = useState(false);
  const [done, setDone] = useState(more === undefined);
  const all = [...sleeves, ...added];

  // An empty answer means there are no more, and a failure is said: neither
  // is asked again.
  function askForMore(ask: NonNullable<typeof more>): void {
    setLooking(true);
    ask(all.length)
      .then((answered) => {
        if (!answered.ok) {
          say(answered.said);
          setDone(true);
          return;
        }
        setAdded((was) => [...was, ...answered.value]);
        if (answered.value.length === 0) setDone(true);
      }, (e: unknown) => {
        showError(e);
        setDone(true);
      })
      .finally(() => {
        setLooking(false);
      });
  }

  const drawn = all.map((sleeve): tSleeve => {
    const { href } = sleeve;
    if (href === undefined) return sleeve;
    const open = () => {
      router.push(href);
    };
    return { ...sleeve, open };
  });
  const asks = more !== undefined && !done && !looking;
  return (
    <Crate
      label={label}
      sleeves={drawn}
      empty={empty}
      looking={looking}
      more={asks ? () => { askForMore(more); } : undefined}
    />
  );
}
