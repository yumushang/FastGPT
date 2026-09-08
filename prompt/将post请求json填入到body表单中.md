## 需求
在点击OpenApi导入按钮导入OpenApi json schame后，并没有将post请求的json数据填入到body表单中，请修改代码。

## 说明
按钮页面：projects/app/src/pageComponents/app/detail/HTTPTools/ManualToolModal.tsx
导入页面：projects/app/src/pageComponents/app/detail/HTTPTools/OpenApiImportModal.tsx

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