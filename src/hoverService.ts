'use strict';
import { Position } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TactCodeWalker, Variable, Function, Struct, Message } from './codeWalkerService';
import { MarkupContent, MarkupKind } from 'vscode-languageserver/node';

export class HoverService {
    
    public rootPath: string | undefined;

    constructor(rootPath: string | undefined) {
        this.rootPath = rootPath;
    }

    public getHoverItems( document: TextDocument | undefined,
                          position: Position): MarkupContent {
        if (document == undefined) {
            return {
                kind: MarkupKind.Markdown,
                value: ""
                };
        }
        let suggestion = null;
        const lines = document.getText().split(/\r?\n/g);
        const wordLine = lines[position.line];

        const wordObject = this.getWord(wordLine, position.character);

        if (wordObject.word == "") {
            return {
                kind: MarkupKind.Markdown,
                value: ""
                };
        }

        try {
            const walker = new TactCodeWalker(this.rootPath); 
            const offset = document.offsetAt(position);

            const documentContract = walker.getAllContracts(document, position);
            let variableType: string | undefined = "global";
            if (documentContract != undefined && documentContract.selectedContract != undefined) {
                let allVariables: Variable[] = documentContract.selectedContract.getAllStateVariables();
                let allStructs: Struct[] = documentContract.selectedContract.getAllStructs();
                let allMessages: Message[] = documentContract.selectedContract.getAllMessages();
                let allFunctions: Function[] = documentContract.selectedContract.getAllFunctions();

                let selectedFunction = documentContract.selectedContract.getSelectedFunction(offset);
                if (selectedFunction !== undefined)  {
                    selectedFunction.findVariableDeclarationsInScope(offset);
                    //adding input parameters
                    allVariables = allVariables.concat(selectedFunction.input);
                    //adding all variables
                    allVariables = allVariables.concat(selectedFunction.variablesInScope);
                }
                if (wordObject.word.indexOf(".") != -1) {
                    const prefix = wordObject.word.split('.')[0];
                    allVariables.forEach(item => {
                        if (item.name === prefix) {
                            if (item.type?.isArray) {
                                variableType = "array";
                            } else if (item.type?.isMapping) {
                                variableType = "mapping";
                            } else {
                                variableType = item.type?.name;
                            }
                        }
                    });
                } else {
                    allVariables.forEach(item => {
                        if (item.name === wordObject.word) {
                            if (item.type?.isArray) {
                                variableType = "array";
                            } else if (item.type?.isMapping) {
                                variableType = "mapping";
                            } else {
                                variableType = item.type?.name;
                            }
                        }
                    });
                }

                allStructs.forEach(item => {
                    if (item.name === wordObject.word) {
                        let description = [`struct ${item.element.name} {\n`];
                        item.element.body.map((item: any) => {
                            let mapType: String[] = [];
                            if (item.literal.literal.type == "MappingExpression") {
                                mapType.push(`map<${item.literal.literal.from.literal}${item.literal.literal.from.is_optional ? "?" : ""}${item.literal.literal.fromPrimitive != "" ? " as " + item.literal.literal.fromPrimitive.literal: ""},
                                                  ${item.literal.literal.to.literal}${item.literal.literal.to.is_optional ? "?" : ""}${item.literal.literal.toPrimitive != "" ? " as " + item.literal.literal.toPrimitive.literal: ""}>`);
                            } else {
                                mapType.push(`${item.literal.literal}${item.literal.is_optional ? "?" : ""}${item.typePrimitive != null ? " as " + item.typePrimitive.literal: ""}`);
                            }
                            description.push(`  ${item.name}: ${mapType.join("")};\n`);
                        });
                        description.push('}');
                        suggestion = description.join("\n");
                    }
                });

                allMessages.forEach(item => {
                    let description = [`message ${(item.element.code ? '(' + item.element.code + ')' : '')} ${item.element.name} {\n`];
                    item.element.body.map((item: any) => {
                        let mapType: String[] = [];
                        if (item.literal.literal.type == "MappingExpression") {
                            mapType.push(`map<${item.literal.literal.from.literal}${item.literal.literal.from.is_optional ? "?" : ""}${item.literal.literal.fromPrimitive != "" ? " as " + item.literal.literal.fromPrimitive.literal: ""},
                                              ${item.literal.literal.to.literal}${item.literal.literal.to.is_optional ? "?" : ""}${item.literal.literal.toPrimitive != "" ? " as " + item.literal.literal.toPrimitive.literal: ""}>`);
                        } else {
                            mapType.push(`${item.literal.literal}${item.literal.is_optional ? "?" : ""}${item.typePrimitive != null ? " as " + item.typePrimitive.literal: ""}`);
                        }
                        description.push(`  ${item.name}: ${mapType.join("")};\n`);
                    });
                    description.push('}');
                    suggestion = description.join("\n");
                });

                allFunctions.forEach(item => {
                    if (item.name === wordObject.word) {
                        let description = [`${item.element.modifier && item.element.modifier.length > 0 ? item.element.modifier.join(" ") + ' ': ''}${item.element.is_native ? 'native': 'fun'} ${item.element.name} (`];
                        let paramsDescription: String[] = [];
                        item.element.params.map((item: any) => {
                            let mapType: String[] = [];
                            if (item.literal.literal.type == "MappingExpression") {
                                mapType.push(`map<${item.literal.literal.from.literal}${item.literal.literal.from.is_optional ? "?" : ""}${item.literal.literal.fromPrimitive != "" ? " as " + item.literal.literal.fromPrimitive.literal: ""},
                                                  ${item.literal.literal.to.literal}${item.literal.literal.to.is_optional ? "?" : ""}${item.literal.literal.toPrimitive != "" ? " as " + item.literal.literal.toPrimitive.literal: ""}>`);
                            } else {
                                mapType.push(`${item.literal.literal}${item.literal.is_optional ? "?" : ""}${item.typePrimitive != null ? " as " + item.typePrimitive.literal: ""}`);
                            }
                            paramsDescription.push(`${item.id}: ${mapType.join("")}`);
                        });
                        description.push(paramsDescription.join(", "));
                        description.push(')');
                        suggestion = description.join("");
                    }
                });
            }
            
            for (const [, value] of Object.entries(hoverDescription)) {
                const re = new RegExp(`${value.pattern}$`);
                if (!wordObject.word.match(re)) continue;
                if (value.type != variableType) continue;
                if (Array.isArray(value.description)) {
                    suggestion =  value.description.join("\n");
                } else {
                    suggestion = value.description;
                }
            }

            documentContract.allStructs.forEach(item => {
                if (item.name === wordObject.word) {
                    let description = [`struct ${item.element.name} {\n`];
                    item.element.body.map((item: any) => {
                        let mapType: String[] = [];
                        if (item.literal.literal.type == "MappingExpression") {
                            mapType.push(`map<${item.literal.literal.from.literal}${item.literal.literal.from.is_optional ? "?" : ""}${item.literal.literal.fromPrimitive != "" ? " as " + item.literal.literal.fromPrimitive.literal: ""},
                                              ${item.literal.literal.to.literal}${item.literal.literal.to.is_optional ? "?" : ""}${item.literal.literal.toPrimitive != "" ? " as " + item.literal.literal.toPrimitive.literal: ""}>`);
                        } else {
                            mapType.push(`${item.literal.literal}${item.literal.is_optional ? "?" : ""}${item.typePrimitive != null ? " as " + item.typePrimitive.literal: ""}`);
                        }
                        description.push(`  ${item.name}: ${mapType.join("")};\n`);
                    });
                    description.push('}');
                    suggestion = description.join("\n");
                }
            });
            documentContract.allMessages.forEach(item => {
                if (item.name === wordObject.word) {
                    let description = [`message ${(item.element.code ? '(' + item.element.code.value + ')' : '')} ${item.element.name} {\n`];
                    item.element.body.map((item: any) => {
                        let mapType: String[] = [];
                        if (item.literal.literal.type == "MappingExpression") {
                            mapType.push(`map<${item.literal.literal.from.literal}${item.literal.literal.from.is_optional ? "?" : ""}${item.literal.literal.fromPrimitive != "" ? " as " + item.literal.literal.fromPrimitive.literal: ""},
                                              ${item.literal.literal.to.literal}${item.literal.literal.to.is_optional ? "?" : ""}${item.literal.literal.toPrimitive != "" ? " as " + item.literal.literal.toPrimitive.literal: ""}>`);
                        } else {
                            mapType.push(`${item.literal.literal}${item.literal.is_optional ? "?" : ""}${item.typePrimitive != null ? " as " + item.typePrimitive.literal: ""}`);
                        }
                        description.push(`  ${item.name}: ${mapType.join("")};\n`);
                    });
                    description.push('}');
                    suggestion = description.join("\n");
                }
            });
            documentContract.allFunctions.forEach(item => {
                if (item.name === wordObject.word) {
                    let description = [`${item.element.modifier && item.element.modifier.length > 0 ? item.element.modifier.join(" ") + ' ': ''}${item.element.is_native ? 'native': 'fun'} ${item.element.name} (`];
                    let paramsDescription: String[] = [];
                    item.element.params.map((item: any) => {
                        let mapType: String[] = [];
                        if (item.literal.literal.type == "MappingExpression") {
                            mapType.push(`map<${item.literal.literal.from.literal}${item.literal.literal.from.is_optional ? "?" : ""}${item.literal.literal.fromPrimitive != "" ? " as " + item.literal.literal.fromPrimitive.literal: ""},
                                              ${item.literal.literal.to.literal}${item.literal.literal.to.is_optional ? "?" : ""}${item.literal.literal.toPrimitive != "" ? " as " + item.literal.literal.toPrimitive.literal: ""}>`);
                        } else {
                            mapType.push(`${item.literal.literal}${item.literal.is_optional ? "?" : ""}${item.typePrimitive != null ? " as " + item.typePrimitive.literal: ""}`);
                        }
                        paramsDescription.push(`${item.id}: ${mapType.join("")}`);
                    });
                    description.push(paramsDescription.join(", "));
                    description.push(')');
                    suggestion = description.join("");
                }
            });

        } catch (error: any) {
            // graceful catch
            //console.log(error.message);
        }
        return  { kind: MarkupKind.Markdown, value: suggestion ?? "" };
    }

    private getWord(lineText: string, characterPosition:number): any {
        let offsetStart = characterPosition;
        let offsetEnd = characterPosition;
        let wordStart = characterPosition;
        let wordEnd = characterPosition;
        const stopCharacters = [" ", "(", ")", "[", "]", ";", "!", "+", "-", "*", ":", ".", "{", "=", "&", "^", "%", "~"];
        while (offsetStart >= -1) {
            wordStart = offsetStart;
            if (stopCharacters.includes(lineText[offsetStart])) {
                break;
            }
            offsetStart--;
        }
        
        while (offsetEnd <= lineText.length) {
            wordEnd = offsetEnd;
            if (stopCharacters.includes(lineText[offsetEnd])) {
                break;
            }
            offsetEnd++;
        }
        const word = lineText.substr(wordStart+1, wordEnd-(wordStart+1));
        return {"start": wordStart,
                "end": wordEnd,
                "word": word
                }
    }
}

const hoverDescription = {
    "import contract": {
        "pattern": "import",
        "type": "global",
        "description": [
            "Tact compiler allows user to import files.\n",
            "Example:\n",
            "```\nimport \"@stdlib/deploy\";\n```",
            "```\ncontract SampleJetton with deploy {\n\\\\...\n}\n```"
        ]
    },
    "address": {
        "pattern": "Address",
        "type": "global",
        "description": [
            "Type Address.\n",
            "Example:\n",
            "```\nowner: Address;\n```\n"
        ]
    },
    "bool": {
        "pattern": "Bool",
        "type": "global",
        "description": [
            "Type Bool.\n",
            "Example:\n",
            "```\ncompleted: Bool;\n```\n"
        ]
    },
    "int": {
        "pattern": "Int",
        "type": "global",
        "description": [
            "Type Int.\n",
            "Example:\n",
            "```\namount: Int;\n```\n"
        ]
    },
    "SendParameters": {
        "pattern": "SendParameters",
        "type": "global",
        "description": [
            "This function will prepare parameters for the message sending:\n",
            "  bounce: bool\n",
            "  to: address\n",
            "  value: int257\n",
            "  mode: int257\n",
            "  body: Maybe ^cell\n",
            "  code: Maybe ^cell\n",
            "  data: Maybe ^cell"
        ]
    },
    "receive": {
        "pattern": "receive",
        "type": "global",
        "description": [
            "Receiver functions are special function that are responsible of ",
            "receiving messages in contracts and could be defined only within ",
            "a contract or trait."
        ]
    },
    "require": {
        "pattern": "require",
        "type": "global",
        "description": [
            "fun require(condition: Bool, error: String);\nChecks condition and throws an exception with error message if condition is false."
        ]
    },
    "getConfigParam":  {
        "pattern": "getConfigParam",
        "type": "global",
        "description": [
            "Get config param.",
            "Return Cell."
        ]
    },
}