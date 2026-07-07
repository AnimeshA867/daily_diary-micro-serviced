"use client";

import { useState, useEffect } from "react";
import { format, isToday } from "date-fns";
import { Save, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { encryptContent, decryptContent, isEncrypted } from "@/lib/encryption";

interface DailyWriterProps {
  user: {
    id: string;
  };
  selectedDate?: string;
  onDateChange?: (date: string) => void;
}

export default function DailyWriter({
  user,
  selectedDate,
  onDateChange,
}: DailyWriterProps) {
  const [content, setContent] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [decryptionError, setDecryptionError] = useState(false);

  const today = new Date();
  const currentDate = selectedDate ? new Date(selectedDate) : today;
  const dateStr = format(currentDate, "yyyy-MM-dd");
  const isReadOnly = !!(selectedDate && !isToday(currentDate));

  useEffect(() => {
    const loadEntry = async () => {
      setIsLoading(true);
      setDecryptionError(false);

      try {
        // Fetch from the Diary Service via our API Gateway
        const data = await apiClient.get<any>(`/api/diary/entries?date=${dateStr}`);

        if (data && data.content) {
          console.log("Content loaded from API:", {
            length: data.content.length,
            firstChars: data.content.substring(0, 50),
            isLikelyEncrypted: isEncrypted(data.content),
          });

          // Check if content is encrypted
          if (isEncrypted(data.content)) {
            console.log("Content appears encrypted, attempting decryption...");
            const decryptedContent = await decryptContent(
              data.content,
              user.id
            );
            console.log("Decryption successful!");
            setContent(decryptedContent);
          } else {
            console.log("Loading plaintext entry");
            setContent(data.content);
          }
        } else {
          console.log("No entry found for this date");
          setContent("");
        }
      } catch (error) {
        console.error("Failed to load or decrypt content:", error);
        setContent("");
        setDecryptionError(true);
      } finally {
        setIsLoading(false);
      }
    };

    loadEntry();
  }, [user.id, dateStr]);

  // Update word count
  useEffect(() => {
    const words = content.trim().split(/\s+/).filter(Boolean).length;
    setWordCount(content.trim() ? words : 0);
  }, [content]);

  // Auto-save logic
  useEffect(() => {
    if (!content || isLoading || isReadOnly) return;

    const timer = setTimeout(async () => {
      const words = content.trim().split(/\s+/).filter(Boolean).length;

      try {
        // Encrypt the content before saving
        const encryptedContent = await encryptContent(content, user.id);

        await apiClient.post("/api/diary/entries", {
          entry_date: dateStr,
          content: encryptedContent,
          word_count: words,
        });
        
        console.log("Auto-save successful");
      } catch (error) {
        console.error("Failed to auto-save encrypted content:", error);
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [content, user.id, dateStr, isLoading, isReadOnly]);

  const handleSave = async () => {
    if (content.trim().length === 0 || isReadOnly) return;

    setIsSaving(true);
    const words = content.trim().split(/\s+/).filter(Boolean).length;

    try {
      // Encrypt the content before saving
      const encryptedContent = await encryptContent(content, user.id);

      await apiClient.post("/api/diary/entries", {
        entry_date: dateStr,
        content: encryptedContent,
        word_count: words,
      });

      // Recalculate streak immediately via http client or let background queue handle it
      try {
        await apiClient.post("/api/streak/invalidate");
      } catch {
        // Invalidation endpoint fails, let RabbitMQ consumer catch it
      }

      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    } catch (error) {
      console.error("Failed to save encrypted content:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreviousDay = () => {
    const prevDay = new Date(currentDate);
    prevDay.setDate(prevDay.getDate() - 1);
    onDateChange?.(format(prevDay, "yyyy-MM-dd"));
  };

  const handleNextDay = () => {
    const nextDay = new Date(currentDate);
    nextDay.setDate(nextDay.getDate() + 1);
    onDateChange?.(format(nextDay, "yyyy-MM-dd"));
  };

  const dateDisplayStr = format(currentDate, "EEEE, MMMM d, yyyy");
  const todayStr = format(today, "yyyy-MM-dd");
  const isTodays = dateStr === todayStr;

  if (isLoading) {
    return (
      <div className="bg-surface border border-border rounded-xl p-6 flex flex-col h-[500px]">
        <div className="flex items-center justify-center h-full">
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            Loading entry...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-muted/30">
        <div className="flex items-center justify-between">
          <button
            onClick={handlePreviousDay}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
            aria-label="Previous day"
          >
            <ChevronLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <div className="text-center flex-1">
            <h3 className="text-lg font-semibold text-foreground">
              {dateDisplayStr}
            </h3>
            <p
              className={`text-xs mt-1 ${
                isTodays
                  ? "text-accent font-medium"
                  : isReadOnly
                  ? "text-muted-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {isTodays ? "✨ Today's Entry" : isReadOnly ? "📖 View Only" : "📝 Past Entry"}
            </p>
          </div>
          <button
            onClick={handleNextDay}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
            aria-label="Next day"
          >
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Decryption Error Warning */}
      {decryptionError && (
        <div className="mx-6 mt-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 p-4 rounded-lg">
          <div className="flex items-start gap-3">
            <span className="text-amber-600 dark:text-amber-400 text-xl">
              ⚠️
            </span>
            <div className="flex-1">
              <h4 className="font-semibold text-amber-900 dark:text-amber-100 mb-1">
                Decryption Failed
              </h4>
              <p className="text-sm text-amber-800 dark:text-amber-200">
                This entry appears to be encrypted but couldn&apos;t be
                decrypted. This may happen if:
              </p>
              <ul className="text-sm text-amber-800 dark:text-amber-200 list-disc pl-5 mt-2 space-y-1">
                <li>You cleared your browser data (encryption keys lost)</li>
                <li>
                  You&apos;re accessing from a different device or browser
                </li>
                <li>The encryption salt is missing from localStorage</li>
              </ul>
              <p className="text-sm text-amber-800 dark:text-amber-200 mt-2">
                The encrypted content is shown below. To recover it, you&apos;ll
                need to restore your encryption salt.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 p-6">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={
            isReadOnly
              ? "No entry for this day..."
              : isTodays
              ? "What's on your mind today? Start writing..."
              : "Write your thoughts here..."
          }
          disabled={isReadOnly}
          className={`
            w-full h-full min-h-[300px] p-0 bg-transparent border-none resize-none
            text-foreground placeholder-muted-foreground/60
            focus:outline-none
            font-serif text-base leading-relaxed
            ${isReadOnly && "cursor-not-allowed opacity-75"}
          `}
        />
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-border bg-muted/20 flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {wordCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="font-medium">{wordCount}</span> words
            </span>
          )}
          {content.trim() && !isReadOnly && (
            <span className="text-xs text-muted-foreground/70">
              Auto-saves as you type
            </span>
          )}
        </div>

        {!isReadOnly && (
          <button
            onClick={handleSave}
            disabled={content.trim().length === 0 || isSaving}
            className={`
              flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm
              transition-all duration-200 shadow-sm
              ${
                isSaved
                  ? "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/30"
                  : "bg-accent text-accent-foreground hover:opacity-90 hover:shadow-md"
              }
              ${content.trim().length === 0 && "opacity-50 cursor-not-allowed"}
            `}
          >
            {isSaved ? (
              <>
                <Check className="w-4 h-4" />
                Saved!
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {isSaving ? "Saving..." : "Save Entry"}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
