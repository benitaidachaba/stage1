"use client";

import { useState } from "react";
import { AppIcons, ICON_SIZE } from "./icons";
import { ACTIONS, UI } from "@/lib/copy";
import { describeAgo } from "@/lib/format";
import { activeNotes } from "@/lib/selectors";
import { useAppStore } from "@/state/AppStore";

/**
 * Notes, separate from tasks. Not everything written down is a thing to do —
 * this is where thinking lives. Writing saves as you go; deleting asks once.
 */
export function NotesView() {
  const { state, dispatch, now } = useAppStore();
  const notes = activeNotes(state);
  const [composing, setComposing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function saveDraft() {
    if (draftBody.trim().length === 0 && draftTitle.trim().length === 0) return;
    dispatch({ type: "note.create", title: draftTitle, body: draftBody });
    setDraftTitle("");
    setDraftBody("");
    setComposing(false);
  }

  return (
    <section className="board" aria-label={UI.notesHeading}>
      <div className="panelHead">
        <h2>{UI.notesHeading}</h2>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            setComposing((open) => !open);
            setOpenId(null);
          }}
        >
          <AppIcons.capture size={ICON_SIZE.control} weight="bold" aria-hidden="true" />
          {UI.notesNew}
        </button>
      </div>

      {composing ? (
        <div className="panel noteComposer">
          <label className="field">
            <span>{UI.notesTitlePlaceholder}</span>
            <input
              type="text"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{UI.notesBodyPlaceholder}</span>
            <textarea
              rows={6}
              value={draftBody}
              onChange={(event) => setDraftBody(event.target.value)}
            />
          </label>
          <div className="row row--wrap">
            <button type="button" className="btn btn--primary" onClick={saveDraft}>
              {ACTIONS.save}
            </button>
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                setComposing(false);
                setDraftTitle("");
                setDraftBody("");
              }}
            >
              {ACTIONS.dismiss}
            </button>
          </div>
        </div>
      ) : null}

      {notes.length === 0 && !composing ? <p className="hint">{UI.notesEmpty}</p> : null}

      <ul className="cards">
        {notes.map((note) =>
          openId === note.id ? (
            <li key={note.id} className="panel noteComposer">
              <label className="field">
                <span>{UI.notesTitlePlaceholder}</span>
                <input
                  type="text"
                  value={note.title}
                  onChange={(event) =>
                    dispatch({ type: "note.update", id: note.id, title: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>{UI.notesBodyPlaceholder}</span>
                <textarea
                  rows={8}
                  value={note.body}
                  onChange={(event) =>
                    dispatch({ type: "note.update", id: note.id, body: event.target.value })
                  }
                />
              </label>
              <div className="row row--wrap">
                <button type="button" className="btn" onClick={() => setOpenId(null)}>
                  {ACTIONS.done}
                </button>
                {confirmDelete === note.id ? (
                  <>
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => {
                        dispatch({ type: "note.delete", id: note.id });
                        setOpenId(null);
                        setConfirmDelete(null);
                      }}
                    >
                      {UI.notesDeleteConfirm}
                    </button>
                    <button type="button" className="btn btn--quiet" onClick={() => setConfirmDelete(null)}>
                      {ACTIONS.dismiss}
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn--quiet" onClick={() => setConfirmDelete(note.id)}>
                    {UI.notesDelete}
                  </button>
                )}
              </div>
            </li>
          ) : (
            <li key={note.id} className="card noteCard">
              <button
                type="button"
                className="noteOpen"
                onClick={() => {
                  setOpenId(note.id);
                  setComposing(false);
                }}
              >
                {note.title ? <strong className="noteTitle">{note.title}</strong> : null}
                <span className="noteBody">{note.body.length > 140 ? `${note.body.slice(0, 140)}…` : note.body}</span>
                <span className="hint">{describeAgo(note.updatedAt, now)}</span>
              </button>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
