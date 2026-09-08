## 需求
- 在添加工具页面,cURL导入按钮左边添加OpenApi导入按钮
- 点击OpenApi导入按钮后，和cURL导入按钮一样，弹出输入框
- 输入框中输入OpenApi json schame，点击导入按钮，解析json schame，将解析结果填入到页面中

## 说明
- 添加工具页面：projects/app/src/pageComponents/app/detail/HTTPTools/ManualToolModal.tsx
- get请求OpenApi json schame示例：
```json
{
  "swagger": "2.0",
  "info": {
    "title": "信访基础模块接口文档",
    "contact": {},
    "license": {
      "name": "Powered By ruoyi",
      "url": "https://ruoyi.vip"
    }
  },
  "host": "localhost:8080",
  "basePath": "/xfjc",
  "schemes": [],
  "consumes": [
    "*/*"
  ],
  "produces": [
    "*/*"
  ],
  "paths": {
    "/xfsl/xfjZcList": {
      "get": {
        "tags": [
          "信访受理"
        ],
        "summary": "信访件暂存列表",
        "operationId": "xfjZcListUsingGET",
        "produces": [
          "*/*"
        ],
        "parameters": [
          {
            "name": "qfwtbs",
            "in": "query",
            "description": "群腐问题标识",
            "required": false,
            "type": "integer",
            "format": "int32"
          },
          {
            "name": "qfwtbsmc",
            "in": "query",
            "description": "群腐问题标识名称",
            "required": false,
            "type": "string"
          },
          {
            "name": "wtsddm",
            "in": "query",
            "description": "问题属地",
            "required": false,
            "type": "string"
          },
          {
            "name": "wtsdmcs",
            "in": "query",
            "description": "问题属地名称",
            "required": false,
            "type": "array",
            "items": {
              "type": "string"
            },
            "collectionFormat": "multi"
          },
          {
            "name": "xfjbh",
            "in": "query",
            "description": "信访件编号",
            "required": false,
            "type": "string"
          },
          {
            "name": "xm",
            "in": "query",
            "description": "姓名",
            "required": false,
            "type": "string"
          },
          {
            "name": "yyid",
            "in": "query",
            "description": "菜单id",
            "required": false,
            "type": "integer",
            "format": "int64"
          },
          {
            "name": "jgid",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "rwrid",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "xfxss",
            "in": "query",
            "required": false,
            "type": "array",
            "items": {
              "type": "string"
            },
            "collectionFormat": "multi"
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "schema": {
              "$ref": "#/definitions/LxVo",
              "originalRef": "LxVo"
            }
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "Forbidden"
          },
          "404": {
            "description": "Not Found"
          }
        },
        "security": [
          {
            "Authorization": [
              "global"
            ]
          }
        ]
      }
    }
  },
  "definitions": {
    "LxVo": {
      "type": "object",
      "properties": {
        "dzldid": {
          "type": "string",
          "description": "党政领导ID"
        },
        "gkxx": {
          "type": "string",
          "description": "概况信息"
        },
        "ldr": {
          "type": "string",
          "description": "领导人"
        },
        "ldzj": {
          "type": "string",
          "description": "领导职级"
        },
        "ldzw": {
          "type": "string",
          "description": "领导职务"
        },
        "qfwtbs": {
          "type": "integer",
          "format": "int32",
          "description": "群腐问题标识"
        },
        "qfwtbsmc": {
          "type": "string",
          "description": "群腐问题标识名称"
        },
        "ssdq": {
          "type": "string",
          "description": "所属地区"
        },
        "wtsdmc": {
          "type": "string",
          "description": "问题属地"
        },
        "xbjzsj": {
          "type": "string",
          "format": "date-time",
          "description": "限办截止时间"
        },
        "xfjbh": {
          "type": "string",
          "description": "信访件编号"
        },
        "xfrq": {
          "type": "string",
          "format": "date-time",
          "description": "信访日期"
        },
        "xfxs": {
          "type": "string",
          "description": "信访形式名称"
        },
        "xfxsmc": {
          "type": "string",
          "description": "信访形式名称"
        },
        "xm": {
          "type": "string",
          "description": "姓名"
        },
        "zyfggz": {
          "type": "string",
          "description": "主要分管工作"
        }
      },
      "title": "LxVo"
    }
  }
}
```

post请求OpenApi json schame示例：
```json
{
  "swagger": "2.0",
  "info": {
    "title": "信访基础模块接口文档",
    "contact": {},
    "license": {
      "name": "Powered By ruoyi",
      "url": "https://ruoyi.vip"
    }
  },
  "host": "localhost:8080",
  "basePath": "/xfjc",
  "schemes": [],
  "consumes": [
    "*/*"
  ],
  "produces": [
    "*/*"
  ],
  "paths": {
    "/aiagent/aiAnalysisCount/add": {
      "post": {
        "tags": [
          "AI分析统计信息"
        ],
        "summary": "新增AI分析统计信息",
        "operationId": "addUsingPOST_69",
        "consumes": [
          "application/json"
        ],
        "produces": [
          "*/*"
        ],
        "parameters": [
          {
            "in": "body",
            "name": "ywAiAnalysisCount",
            "description": "ywAiAnalysisCount",
            "required": true,
            "schema": {
              "$ref": "#/definitions/YwAiAnalysisCount",
              "originalRef": "YwAiAnalysisCount"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "schema": {
              "type": "object",
              "additionalProperties": {
                "type": "object"
              }
            }
          },
          "201": {
            "description": "Created"
          },
          "401": {
            "description": "Unauthorized"
          },
          "403": {
            "description": "Forbidden"
          },
          "404": {
            "description": "Not Found"
          }
        },
        "security": [
          {
            "Authorization": [
              "global"
            ]
          }
        ]
      }
    }
  },
  "definitions": {
    "YwAiAnalysisCount": {
      "type": "object",
      "properties": {
        "classifyId": {
          "type": "string",
          "description": "类案ID",
          "refType": null
        },
        "countType": {
          "type": "integer",
          "format": "int32",
          "refType": null
        },
        "dbgjj": {
          "type": "integer",
          "format": "int64",
          "description": "督办-国家局",
          "refType": null
        },
        "dbsheng": {
          "type": "integer",
          "format": "int64",
          "description": "督办-省级",
          "refType": null
        },
        "dbshi": {
          "type": "integer",
          "format": "int64",
          "description": "督办市级",
          "refType": null
        },
        "id": {
          "type": "integer",
          "format": "int64",
          "refType": null
        },
        "jjf": {
          "type": "integer",
          "format": "int64",
          "description": "进京访",
          "refType": null
        },
        "tempId": {
          "type": "string",
          "description": "纯案id",
          "refType": null
        },
        "xfjCount": {
          "type": "integer",
          "format": "int64",
          "description": "信访件数量",
          "refType": null
        },
        "xfrCount": {
          "type": "integer",
          "format": "int64",
          "description": "信访人数",
          "refType": null
        }
      },
      "title": "YwAiAnalysisCount"
    }
  }
}
```