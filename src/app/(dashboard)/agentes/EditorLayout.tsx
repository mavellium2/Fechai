"use client";
import { createContext, useContext } from "react";
export const EditorLayout = createContext(false);
export const useInlineEditor = () => useContext(EditorLayout);
