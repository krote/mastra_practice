import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { success } from "zod/v4";

// Github API を実行するためのトークンは環境変数から取得
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

export const githubCreateIssueTool = createTool( {
    id: "githubCreateIssue",
    description:
    "Github上での複数のIssueを作成します。バグ報告、機能要求、質問などに使用できます",
    inputSchema: z.object( {
        owner: z
        .string()
        .describe("リポジトリの所有者名（ユーザー名またはorganization名）"),
        repo: z.string().describe("リポジトリ名"),
        issues: z.array( z.object({
            title: z.string().describe("Issueのタイトル"),
            body: z.string().optional().describe("Issueの本文・詳細説明"),
        })).describe("作成するIssueのリスト"),
    }),
    outputSchema: z.object({
        success: z.boolean(),
        // created Issues も配列
        createdIssues: z.array(z.object({
            issueNumber: z.number().optional(),
            issueUrl: z.string().optional(),
            title: z.string(),
        })),
        errors: z.array(z.string()).optional(),
    }),
    execute: async( { context } ) => {
        // inputSchemaに従った取得
        const { owner, repo, issues } = context;
        const createdIssues: Array<{ issueNumber?: number; issueUrl?: string; title: string }> = [];
        const errors: string[] = [];

        for (const issue of  issues){
            try{
                // issue作成APIを実行
                const response = await fetch(
                    `https://api.github.com/repos/${owner}/${repo}/issues`,
                    {
                        method: "POST",
                        headers: {
                            Accept: "application/vnd.github+json",
                            Authorization: `Bearer ${GITHUB_TOKEN}`,
                            "X-Github-Api-Version": "2022-11-28",
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            title: issue.title,
                            body: issue.body,
                        }),
                    }
                );
                // エラーハンドリング
                if( !response.ok) {
                    const errorData = await response.json();
                    const errorMessage = `Github API エラー： ${response.status} - ${errorData.message || "Unknown error"}`;
                    // 作成したissueはerrorsに格納
                    errors.push(`failed to create issue "${issue.title}": ${errorMessage}`) ;
                    continue;
                }
                // issue作成できた場合はcreateIssuesに保存
                const issueData = await response.json();
                createdIssues.push({
                    issueNumber: issueData.number,
                    issueUrl: issueData.url,
                    title: issue.title,
                });
            } catch(error){
                const errorMessage = `リクエスト失敗: ${error instanceof Error ? error.message : "Unknown Error"}`;
                errors.push(`Error creating issue "${issue.title}": ${errorMessage}`);
            }
        }
        return {
            success: createdIssues.length > 0,
            createdIssues,
            errors:errors.length > 0 ? errors : undefined,
        };
    },
});