export interface ConditionNode {
  type: 'CONDITION';
  field: string;
  operator: '=' | '>' | '<' | '>=' | '<=' | 'in';
  value: string | number | boolean | (string | number | boolean)[];
}

export interface LogicalNode {
  type: 'AND' | 'OR';
  children: AstNode[];
}

export type AstNode = ConditionNode | LogicalNode;

export interface ConvertResult {
  pgJsonb?: string;
  mongoDb?: string;
  error?: string;
}

/**
 * 将简单SQL条件转换为PostgreSQL jsonb查询和MongoDB查询语法
 * 支持: =, >, <, >=, <=, IN 操作符
 * 支持: AND, OR 逻辑运算符及嵌套
 */
export function convertSqlCondition(sqlCondition: string): ConvertResult {
  // Step 1: 预处理 —— 在操作符两侧插入空格，但保护字符串字面量
  let cleaned = sqlCondition.trim();

  // 用占位符保护字符串字面量（支持单引号和双引号，含转义）
  const placeholders: string[] = [];
  cleaned = cleaned.replace(/(['"])(?:(?!\1)[^\\]|\\.)*\1/g, (match) => {
    const placeholder = `__STRING_${placeholders.length}__`;
    placeholders.push(match);
    return placeholder;
  });

  // 标准化操作符：注意顺序！先处理 >= <=，再处理 > < =
  // 注意：使用特殊标记避免被后续步骤破坏，然后再转回标准格式
  cleaned = cleaned
    .replace(/\s*>=\s*/g, ' __GE__ ')
    .replace(/\s*<=\s*/g, ' __LE__ ')
    .replace(/\s*>\s*/g, ' > ')
    .replace(/\s*</g, ' < ')
    .replace(/\s*=\s*/g, ' = ')
    // 处理 IN（不区分大小写，兼容 IN( 和 IN (）
    .replace(/\s+([iI][nN])\s*(?=\()/g, ' IN ')
    .replace(/\s*\(\s*/g, ' ( ')
    .replace(/\s*\)\s*/g, ' ) ')
    // 处理逗号（在IN语句中分隔值）
    .replace(/\s*,\s*/g, ' , ')
    // 合并多余空格
    .replace(/\s+/g, ' ')
    .trim();

  // 恢复特殊标记为标准操作符
  cleaned = cleaned.replace(/__GE__/g, '>=').replace(/__LE__/g, '<=');

  // 恢复字符串字面量
  cleaned = cleaned.replace(/__STRING_(\d+)__/g, (_, index) => placeholders[Number(index)]);

  // Step 2: Tokenize
  function tokenize(str: string): string[] {
    if (!str) return [];
    const tokens: string[] = [];
    let current = '';
    let inString = false;
    let quoteChar = '';

    for (let i = 0; i < str.length; i++) {
      const char = str[i];

      if (!inString && (char === "'" || char === '"')) {
        inString = true;
        quoteChar = char;
        current += char;
        continue;
      }

      if (inString) {
        current += char;
        if (char === quoteChar && str[i - 1] !== '\\') {
          inString = false;
        }
        continue;
      }

      if (char === ' ' || char === '(' || char === ')' || char === ',') {
        if (current !== '') {
          tokens.push(current);
          current = '';
        }
        if (char !== ' ') {
          tokens.push(char);
        }
        continue;
      }

      current += char;
    }

    if (current !== '') {
      tokens.push(current);
    }

    return tokens;
  }

  // Step 3: Parse to AST
  // 使用递归下降解析器，支持完整的 AND/OR 嵌套
  // 优先级: OR < AND < CONDITION
  function parse(tokens: string[]): AstNode {
    let index = 0;

    // 解析 OR 表达式（最低优先级）
    function parseOrExpression(): AstNode {
      let left = parseAndExpression();

      while (index < tokens.length) {
        const token = tokens[index];
        if (token.toLowerCase() === 'or') {
          index++;
          const right = parseAndExpression();
          // 如果左边已经是 OR 节点，直接添加子节点
          if (left.type === 'OR') {
            left.children.push(right);
          } else {
            left = { type: 'OR', children: [left, right] };
          }
        } else {
          break;
        }
      }

      return left;
    }

    // 解析 AND 表达式（中等优先级）
    function parseAndExpression(): AstNode {
      let left = parsePrimary();

      while (index < tokens.length) {
        const token = tokens[index];
        if (token.toLowerCase() === 'and') {
          index++;
          const right = parsePrimary();
          // 如果左边已经是 AND 节点，直接添加子节点
          if (left.type === 'AND') {
            left.children.push(right);
          } else {
            left = { type: 'AND', children: [left, right] };
          }
        } else if (token.toLowerCase() === 'or') {
          // 遇到 OR 时，返回当前 AND 表达式，让上层处理 OR
          break;
        } else if (token === ')') {
          // 遇到右括号，结束当前表达式
          break;
        } else {
          throw new Error(`Unexpected token: "${token}" at position ${index}`);
        }
      }

      return left;
    }

    // 解析基本表达式（括号或条件）
    function parsePrimary(): AstNode {
      const token = tokens[index];
      if (token === '(') {
        index++;
        const expr = parseOrExpression();
        if (tokens[index] !== ')') {
          throw new Error('Unclosed parenthesis');
        }
        index++;
        return expr;
      } else if (isField(token)) {
        return parseCondition();
      } else {
        throw new Error(`Expected field or "(", got "${token}" at position ${index}`);
      }
    }

    // 解析条件节点
    function parseCondition(): ConditionNode {
      const field = tokens[index];
      index++;

      if (index >= tokens.length) {
        throw new Error(`Missing operator after field "${field}"`);
      }

      const rawOp = tokens[index];
      const operator = rawOp.toLowerCase() as ConditionNode['operator'];

      if (!['=', '>', '<', '>=', '<=', 'in'].includes(operator)) {
        throw new Error(`Unsupported operator: "${rawOp}"`);
      }
      index++;

      let value: ConditionNode['value'];
      if (operator === 'in') {
        if (tokens[index] !== '(') throw new Error('Expected "(" after IN');
        index++;
        value = [];
        while (tokens[index] !== ')') {
          if (tokens[index] === ',') {
            index++;
            continue;
          }
          value.push(parseValue(tokens[index]));
          index++;
          if (tokens[index] === ',') index++;
        }
        index++;
      } else {
        if (index >= tokens.length) {
          throw new Error(`Missing value after operator "${rawOp}"`);
        }
        value = parseValue(tokens[index]);
        index++;
      }

      return { type: 'CONDITION', field, operator, value };
    }

    function isField(str: string): boolean {
      return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(str);
    }

    function parseValue(str: string): string | number | boolean {
      if (
        (str.startsWith("'") && str.endsWith("'")) ||
        (str.startsWith('"') && str.endsWith('"'))
      ) {
        return str.slice(1, -1).replace(/\\(["'])/g, '$1');
      }
      if (str === 'true') return true;
      if (str === 'false') return false;
      const num = Number(str);
      if (!isNaN(num) && str.trim() !== '') return num;
      return str;
    }

    return parseOrExpression();
  }

  // Step 4: Generate PostgreSQL jsonb syntax
  function toPgJsonb(ast: AstNode): string {
    if (ast.type === 'CONDITION') {
      const { field, operator, value } = ast;
      const jsonbField = `custom_data->>'${field}'`;

      let formattedValue: string;
      if (typeof value === 'string') {
        formattedValue = value;
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        formattedValue = String(value);
      } else {
        formattedValue = String(value);
      }

      switch (operator) {
        case '=':
          return `${jsonbField} = '${formattedValue}'`;
        case '>':
          return `${jsonbField} > '${formattedValue}'`;
        case '<':
          return `${jsonbField} < '${formattedValue}'`;
        case '>=':
          return `${jsonbField} >= '${formattedValue}'`;
        case '<=':
          return `${jsonbField} <= '${formattedValue}'`;
        case 'in':
          const valuesStr = (value as (string | number | boolean)[]).map((v) => `'${v}'`).join(',');
          return `${jsonbField} IN (${valuesStr})`;
        default:
          throw new Error(`Unsupported operator: ${operator}`);
      }
    } else if (ast.type === 'AND' || ast.type === 'OR') {
      const childrenSql = ast.children
        .map((child) => `(${toPgJsonb(child)})`)
        .join(` ${ast.type} `);
      return childrenSql;
    } else {
      throw new Error(`Unknown AST type: ${(ast as any).type}`);
    }
  }

  // Step 5: Generate MongoDB syntax
  function toMongoDb(ast: AstNode): Record<string, any> {
    if (ast.type === 'CONDITION') {
      const { field, operator, value } = ast;
      const prefixedField = `custom_data.${field}`;
      const mongoOp: Record<string, any> = {};

      switch (operator) {
        case '=':
          mongoOp[prefixedField] = value;
          break;
        case '>':
          mongoOp[prefixedField] = { $gt: value };
          break;
        case '<':
          mongoOp[prefixedField] = { $lt: value };
          break;
        case '>=':
          mongoOp[prefixedField] = { $gte: value };
          break;
        case '<=':
          mongoOp[prefixedField] = { $lte: value };
          break;
        case 'in':
          mongoOp[prefixedField] = { $in: value };
          break;
        default:
          throw new Error(`Unsupported operator: ${operator}`);
      }
      return mongoOp;
    } else if (ast.type === 'AND') {
      return { $and: ast.children.map(toMongoDb) };
    } else if (ast.type === 'OR') {
      return { $or: ast.children.map(toMongoDb) };
    } else {
      throw new Error(`Unknown AST type: ${(ast as any).type}`);
    }
  }

  // Main execution
  try {
    const tokens = tokenize(cleaned);
    if (tokens.length === 0) {
      throw new Error('Empty condition');
    }
    const ast = parse(tokens);
    return {
      pgJsonb: toPgJsonb(ast),
      mongoDb: JSON.stringify(toMongoDb(ast), null, 2)
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
