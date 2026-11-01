// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { item } from "../test/fixtures";
import { newView, type View } from "../lib/views";
import { ViewSettings } from "./ViewSettings";

const items = [
  item({ id: "a", queue_id: "q", file_name: "a.mkv", url: "https://cdn.example.com/a.mkv" }),
  item({ id: "b", queue_id: "q", file_name: "b.pdf", url: "https://other.org/b.pdf" }),
];

function setup(patch: Partial<View> = {}) {
  const onChange = vi.fn();
  const onDelete = vi.fn();
  render(
    <ViewSettings view={{ ...newView("v"), ...patch }} items={items} onChange={onChange} onDelete={onDelete} onClose={() => {}} />,
  );
  return { onChange, onDelete };
}

afterEach(cleanup);

describe("ViewSettings", () => {
  it("renames the view as it's typed", () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByLabelText("View name"), { target: { value: "Shows" } });
    expect(onChange).toHaveBeenCalledWith({ name: "Shows" });
  });

  it("toggles a kind", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Video" }));
    expect(onChange).toHaveBeenCalledWith({ kinds: ["video"] });
  });

  it("adds typed extensions on Enter and suggested ones on a click", () => {
    const { onChange } = setup();
    const field = screen.getByLabelText("Extensions");
    fireEvent.change(field, { target: { value: ".SRT" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({ exts: ["srt"] });
    fireEvent.click(screen.getByRole("button", { name: "+ .pdf" }));
    expect(onChange).toHaveBeenCalledWith({ exts: ["pdf"] });
  });

  it("offers download hosts for a site and adds the one picked", () => {
    const { onChange } = setup();
    const field = screen.getByLabelText("Add a site");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "example" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Ccdn.example.com", "Eexample.com"]);
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({ sources: [{ domain: "example.com", sub: true }] });
  });

  it("switches a site to include subdomains, and removes it", () => {
    const { onChange } = setup({ sources: [{ domain: "other.org", sub: false }] });
    fireEvent.click(screen.getByTitle("This site only"));
    expect(onChange).toHaveBeenCalledWith({ sources: [{ domain: "other.org", sub: true }] });
    const removes = screen.getAllByTitle("Remove");
    fireEvent.click(removes[removes.length - 1]);
    expect(onChange).toHaveBeenCalledWith({ sources: [] });
  });

  it("changes the layout and status, and deletes the view", () => {
    const { onChange, onDelete } = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Flat" }));
    expect(onChange).toHaveBeenCalledWith({ layout: "flat" });
    fireEvent.click(screen.getByRole("radio", { name: "Finished" }));
    expect(onChange).toHaveBeenCalledWith({ status: "done" });
    fireEvent.click(screen.getByRole("button", { name: "Delete view" }));
    expect(onDelete).toHaveBeenCalled();
  });
});
