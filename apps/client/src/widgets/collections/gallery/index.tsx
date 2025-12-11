import "./index.css";

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ViewModeProps } from "../interface";
import { Pager, usePagination } from "../Pagination";
import { useFilteredNoteIds } from "../legacy/utils";
import FNote from "../../../entities/fnote";
import { createImageSrcUrl } from "../../../services/utils";
import { getUrlForDownload } from "../../../services/open";
import link from "../../../services/link";
import Icon from "../../react/Icon";
import tree from "../../../services/tree";
import { useNoteLabel, useNoteLabelBoolean } from "../../react/hooks";
import Button from "../../react/Button";
import { t } from "../../../services/i18n";

type GalleryConfig = {
    columns?: number;
    showTitles?: boolean;
    aspectRatio?: string;
};

export default function GalleryView({
    note,
    noteIds: unfilteredNoteIds,
    viewConfig,
    onReady,
    media
}: ViewModeProps<GalleryConfig>) {

    const containerRef = useRef<HTMLDivElement>(null);
    const filteredNoteIds = useFilteredNoteIds(note, unfilteredNoteIds);
    const { pageNotes, ...pagination } = usePagination(note, filteredNoteIds);
    const [sortedPageNotes, setSortedPageNotes] = useState<FNote[] | undefined>();
    const [sortBy] = useNoteLabel(note, "gallery:sortBy");
    const [showNotes] = useNoteLabelBoolean(note, "gallery:showNotes");
    const [hideChildGalleries] = useNoteLabelBoolean(note, "gallery:hideChildGalleries");

    const config: Required<GalleryConfig> = useMemo(
        () => ({
            columns: viewConfig?.columns ?? 6,
            showTitles: viewConfig?.showTitles ?? true,
            aspectRatio: viewConfig?.aspectRatio ?? "1 / 1"
        }),
        [viewConfig]
    );


    // Fetch metadata and sort notes
    useEffect(() => {
        let cancelled = false;

        async function sortNotes() {
            if (!pageNotes) {
                setSortedPageNotes(undefined);
                return;
            }

            const isFolder = (n: FNote) => n.type === "book" || n.isLabelTruthy("collection");

            // Filter based on showNotes and showChildGalleries settings
            let filteredNotes = pageNotes;
            filteredNotes = pageNotes.filter(n => {
                const isFolder = n.type === "book" || n.isLabelTruthy("collection");

                // Filter out child galleries if hideChildGalleries is true
                if (isFolder && hideChildGalleries) return false;

                // Filter out non-media notes if showNotes is false
                if (!isFolder && !showNotes) {
                    const kind = classifyNote(n);
                    return kind === "image" || kind === "video" || kind === "audio";
                }

                return true;
            });

            // Fetch metadata in parallel
            const notesWithMeta = await Promise.all(
                filteredNotes.map(async (n) => ({
                    note: n,
                    date: await n.getMetadata()
                        .then(meta => meta.utcDateCreated || meta.dateCreated || "")
                        .catch(() => "")
                }))
            );

            if (cancelled) return;

            const currentSortBy = sortBy || "newest";

            notesWithMeta.sort((a, b) => {
                // Folders before files
                const folderDiff = (isFolder(a.note) ? 0 : 1) - (isFolder(b.note) ? 0 : 1);
                if (folderDiff !== 0) return folderDiff;

                if (currentSortBy === "title") {
                    // Sort by title only
                    return a.note.title.localeCompare(b.note.title);
                }

                // Sort by date
                if (a.date && b.date) {
                    const dateDiff = currentSortBy === "newest"
                        ? b.date.localeCompare(a.date)  // newest first
                        : a.date.localeCompare(b.date);  // oldest first
                    if (dateDiff !== 0) return dateDiff;
                }

                // Alphabetical fallback
                return a.note.title.localeCompare(b.note.title);
            });

            setSortedPageNotes(notesWithMeta.map(x => x.note));
        }

        sortNotes();
        return () => { cancelled = true; };
    }, [pageNotes, sortBy, showNotes, hideChildGalleries]); // Add showNotes to dependencies

    // Wait for media to load before signaling ready (for print)
    useEffect(() => {
        if (!sortedPageNotes || !onReady) return;

        const container = containerRef.current;
        if (!container || media !== "print") {
            onReady();
            return;
        }

        // Wait for all images/videos to load
        const mediaElements = container.querySelectorAll<HTMLImageElement | HTMLVideoElement>("img, video");

        Promise.allSettled(
            Array.from(mediaElements).map(el =>
                new Promise<void>(resolve => {
                    if (el.tagName === "IMG" && (el as HTMLImageElement).complete) {
                        resolve();
                    } else if (el.tagName === "VIDEO" && (el as HTMLVideoElement).readyState >= 2) {
                        resolve();
                    } else {
                        const events = el.tagName === "IMG" ? ["load", "error"] : ["loadeddata", "error"];
                        events.forEach(evt => el.addEventListener(evt, () => resolve(), { once: true }));
                    }
                })
            )
        ).finally(onReady);
    }, [sortedPageNotes, onReady, media]);

    const handleUploadClick = () => {
        // TODO: Implement image upload functionality
        console.log("Upload button clicked - implementation pending");
    };

    return (
        <div className="gallery-view note-list">
            <div className="note-list-wrapper">
                <div className="gallery-header">
                    {note.type !== "search" && (
                        <Button
                            icon="bx bx-upload"
                            text={t("gallery_view.upload-images")}
                            onClick={handleUploadClick}
                        />
                    )}
                </div>

                <Pager {...pagination} />

                <div
                    ref={containerRef}
                    className="gallery-grid use-tn-links"
                    style={{ gridTemplateColumns: `repeat(${config.columns}, minmax(0, 1fr))` }}
                >
                    {sortedPageNotes?.map(child => (
                        <GalleryCard
                            key={child.noteId}
                            note={child}
                            parent={note}
                            aspectRatio={config.aspectRatio}
                            showTitle={config.showTitles}
                        />
                    ))}
                </div>

                <Pager {...pagination} />
            </div>
        </div>
    );
}

function GalleryCard({ note, parent, showTitle, aspectRatio }: {
    note: FNote;
    parent: FNote;
    showTitle: boolean;
    aspectRatio: string;
}) {
    const notePath = parent.type === "search" ? note.noteId : `${parent.noteId}/${note.noteId}`;
    const isFolder = note.type === "book" || note.isLabelTruthy("collection");

    return (
        <div
            className={`gallery-card block-link no-tooltip-preview ${note.isArchived ? "archived" : ""} ${isFolder ? "is-folder" : ""}`}
            data-href={`#${notePath}`}
            data-note-id={note.noteId}
            onClick={(e) => link.goToLink(e)}
        >
            <div className="gallery-media" style={{ aspectRatio }} title={note.title}>
                {isFolder ? <FolderPreview /> : <MediaPreview note={note} />}
            </div>
            {showTitle && (
                <div className="gallery-caption" title={note.title}>
                    <GalleryTitle note={note} parent={parent} />
                </div>
            )}
        </div>
    );
}

function FolderPreview() {
    return (
        <div className="gallery-fallback folder-fallback">
            <Icon icon="bx bx-folder" />
        </div>
    );
}

function MediaPreview({ note }: { note: FNote }) {
    const kind = classifyNote(note);

    if (kind === "image") {
        return <img className="gallery-img" src={createImageSrcUrl(note)} alt={note.title} loading="lazy" />;
    }

    if (kind === "video") {
        return (
            <video
                className="gallery-video"
                src={getUrlForDownload(`api/notes/${note.noteId}/open-partial`)}
                muted
                playsInline
                preload="metadata"
            />
        );
    }

    const icon = kind === "audio" ? "bx bx-music" : note.getIcon();
    return (
        <div className="gallery-fallback">
            <Icon icon={icon} />
        </div>
    );
}

function classifyNote(note: FNote): "image" | "video" | "audio" | "other" {
    if (note.type === "image") return "image";
    if (note.type === "file") {
        if (note.mime.startsWith("video/")) return "video";
        if (note.mime.startsWith("audio/")) return "audio";
        if (note.mime.startsWith("image/")) return "image";
    }
    return "other";
}

function GalleryTitle({ note, parent }: { note: FNote; parent: FNote }) {
    const [title, setTitle] = useState(note.title);

    useEffect(() => {
        tree.getNoteTitle(note.noteId, parent.noteId).then(setTitle);
    }, [note.noteId, parent.noteId]);

    return <span className="gallery-title">{title}</span>;
}
