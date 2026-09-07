import type { LocalStorage } from "./LocalStorage";
import type { DataAdapter } from "../DataAdapter";
import { createTemplateImport, type TemplateImport } from "./templateImport";
import { LocalCore } from "./localCore";
import * as vocabulary from "./vocabulary";
import * as students from "./students";
import * as availability from "./availability";
import * as templates from "./templates";
import * as views from "./views";
import * as series from "./seriesSuggestions";
import * as tracks from "./tracks";
import * as longTasks from "./longTasks";
import * as tasks from "./tasks";
import * as dayClose from "./dayClose";

export class SqliteLocalDataAdapter implements DataAdapter {
  private readonly core: LocalCore;
  private readonly templateImport: TemplateImport;

  constructor(storage: LocalStorage) {
    this.core = new LocalCore(storage);
    this.templateImport = createTemplateImport(this);
  }

  previewTemplateImport(file: File): Promise<unknown> {
    return this.templateImport.previewTemplateImport(file);
  }

  executeTemplateImport(
    jobId: string,
    mappings: Array<Record<string, unknown>>,
  ): Promise<unknown> {
    return this.templateImport.executeTemplateImport(jobId, mappings);
  }

  getImportErrors(jobId: string, limit = 200, offset = 0): Promise<unknown> {
    return this.templateImport.getImportErrors(jobId, limit, offset);
  }

  listStudents(query?: string): Promise<unknown> {
    return students.listStudents(this.core, query);
  }

  getStudent(studentId: string): Promise<unknown> {
    return students.getStudent(this.core, studentId);
  }

  createStudent(input: Record<string, unknown>): Promise<unknown> {
    return students.createStudent(this.core, input);
  }

  updateStudent(
    studentId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    return students.updateStudent(this.core, studentId, input);
  }

  deleteStudent(studentId: string): Promise<void> {
    return students.deleteStudent(this.core, studentId);
  }
  getWeeklyPattern(studentId: string): Promise<unknown> {
    return availability.getWeeklyPattern(this.core, studentId);
  }

  saveWeeklyPattern(
    studentId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    return availability.saveWeeklyPattern(this.core, studentId, input);
  }

  getWeekPlan(studentId: string, weekStart: string): Promise<unknown> {
    return availability.getWeekPlan(this.core, studentId, weekStart);
  }

  saveWeekPlan(
    studentId: string,
    weekStart: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    return availability.saveWeekPlan(this.core, studentId, weekStart, input);
  }
  listTemplates(query?: string): Promise<unknown> {
    return templates.listTemplates(this.core, query);
  }

  createTemplate(input: Record<string, unknown>): Promise<unknown> {
    return templates.createTemplate(this.core, input);
  }

  getTemplateDetail(templateId: string): Promise<unknown> {
    return templates.getTemplateDetail(this.core, templateId);
  }

  listVersionItems(versionId: string): Promise<unknown> {
    return templates.listVersionItems(this.core, versionId);
  }

  replaceVersionItems(
    versionId: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    return templates.replaceVersionItems(this.core, versionId, input);
  }

  publishVersion(versionId: string): Promise<unknown> {
    return templates.publishVersion(this.core, versionId);
  }

  createTemplateDraft(templateId: string): Promise<unknown> {
    return templates.createTemplateDraft(this.core, templateId);
  }

  getTemplateUsage(templateId: string): Promise<unknown> {
    return templates.getTemplateUsage(this.core, templateId);
  }

  getTemplateItemUsage(itemId: string): Promise<unknown> {
    return templates.getTemplateItemUsage(this.core, itemId);
  }
  listStudentTracks(studentId: string, status?: string): Promise<unknown> {
    return tracks.listStudentTracks(this.core, studentId, status);
  }

  getTrack(trackId: string): Promise<unknown> {
    return tracks.getTrack(this.core, trackId);
  }

  mountTrack(input: Record<string, unknown>): Promise<unknown> {
    return tracks.mountTrack(this.core, input);
  }

  listLongTasks(query?: string): Promise<unknown> {
    return longTasks.listLongTasks(this.core, query);
  }

  createLongTask(input: Record<string, unknown>): Promise<unknown> {
    return longTasks.createLongTask(this.core, input);
  }

  mountLongTask(input: Record<string, unknown>): Promise<unknown> {
    return longTasks.mountLongTask(this.core, input);
  }

  convertTaskToLongTask(
    taskId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    return longTasks.convertTaskToLongTask(this.core, taskId, input);
  }

  resumeSequenceTrack(
    trackId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    return longTasks.resumeSequenceTrack(this.core, trackId, input);
  }

  listSeriesSuggestions(studentId: string): Promise<unknown> {
    return series.listSeriesSuggestions(this.core, studentId);
  }

  dismissSeriesSuggestion(
    studentId: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    return series.dismissSeriesSuggestion(this.core, studentId, input);
  }

  createAdHocTask(input: Record<string, unknown>): Promise<unknown> {
    return tasks.createAdHocTask(this.core, input);
  }

  carryForwardTask(input: Record<string, unknown>): Promise<unknown> {
    return tasks.carryForwardTask(this.core, input);
  }

  completeTask(input: Record<string, unknown>): Promise<unknown> {
    return tasks.completeTask(this.core, input);
  }

  reopenTask(input: Record<string, unknown>): Promise<unknown> {
    return tasks.reopenTask(this.core, input);
  }

  rescheduleTask(input: Record<string, unknown>): Promise<unknown> {
    return tasks.rescheduleTask(this.core, input);
  }

  updateTask(taskId: string, input: Record<string, unknown>): Promise<unknown> {
    return tasks.updateTask(this.core, taskId, input);
  }

  duplicateTask(taskId: string, input: Record<string, unknown>): Promise<void> {
    return tasks.duplicateTask(this.core, taskId, input);
  }

  createNextSeriesTask(taskId: string): Promise<unknown> {
    return tasks.createNextSeriesTask(this.core, taskId);
  }

  createSubTask(
    parentTaskId: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    return tasks.createSubTask(this.core, parentTaskId, input);
  }

  linkMainTask(
    taskId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    return tasks.linkMainTask(this.core, taskId, input);
  }

  deleteTask(taskId: string, input: Record<string, unknown>): Promise<void> {
    return tasks.deleteTask(this.core, taskId, input);
  }

  reorderTask(
    taskId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    return tasks.reorderTask(this.core, taskId, input);
  }
  triggerDayClose(businessDate: string): Promise<unknown> {
    return dayClose.triggerDayClose(this.core, businessDate);
  }

  reconcileStartup(businessDate: string): Promise<unknown> {
    return dayClose.reconcileStartup(this.core, businessDate);
  }

  getTodayCarryovers(targetDate: string): Promise<unknown> {
    return dayClose.getTodayCarryovers(this.core, targetDate);
  }

  undoCarryover(input: Record<string, unknown>): Promise<unknown> {
    return dayClose.undoCarryover(this.core, input);
  }
  getToday(date?: string): Promise<unknown> {
    return views.getToday(this.core, date);
  }

  getWorkbench(from?: string, to?: string): Promise<unknown> {
    return views.getWorkbench(this.core, from, to);
  }

  getSchedule(
    studentId: string,
    params?: { from?: string; to?: string; view?: string },
  ): Promise<unknown> {
    return views.getSchedule(this.core, studentId, params);
  }

  searchGlobal(query: string, limit: number): Promise<unknown> {
    return views.searchGlobal(this.core, query, limit);
  }

  listVocabulary(
    studentId: string,
    params?: { from?: string; to?: string; subject?: string },
  ): Promise<unknown> {
    return vocabulary.listVocabulary(this.core, studentId, params);
  }

  previewVocabularyBatch(
    studentId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    return vocabulary.previewVocabularyBatch(this.core, studentId, input);
  }

  saveVocabularyBatch(
    studentId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    return vocabulary.saveVocabularyBatch(this.core, studentId, input);
  }

  updateVocabularyEntry(
    entryId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    return vocabulary.updateVocabularyEntry(this.core, entryId, input);
  }
}
